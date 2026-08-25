import { CHROME_UA } from "../utils/index.js";
import { scraperFetch, createScraperResult } from "./httpHelper.js";

export let _ytSource = null;
export function setYouTubeSource(src) {
  _ytSource = src;
}

export async function scrapeYouTube(url) {
  let currentStatus = null;
  try {
    const videoId = url.match(
      /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i,
    )?.[1];
    if (!videoId) throw new Error("Invalid YouTube URL");

    if (!_ytSource) return { requireSource: true };

    const oembed = async () => {
      let title = "YouTube Video";
      let thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      try {
        const oData = await scraperFetch(
          {
            url: `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
          },
          "YouTube Oembed",
        );
        if (oData) {
          title = oData.title || title;
          thumbnail = oData.thumbnail_url || thumbnail;
        }
      } catch (e) {}
      return { title, thumbnail };
    };

    const meta = await oembed();

    if (_ytSource === "gg") {
      const headers = {
        Origin: "https://media.ytmp3.gg",
        Referer: "https://media.ytmp3.gg/",
        "User-Agent": CHROME_UA,
        Accept: "application/json, text/plain, */*",
      };
      const runConvert = async (format, quality) => {
        try {
          const convRes = await scraperFetch(
            {
              url: "https://hub.convert1s.com/api/download",
              method: "POST",
              headers: { ...headers, "Content-Type": "application/json" },
              data: JSON.stringify({
                url,
                os: "macos",
                output: {
                  type: format === "mp4" ? "video" : "audio",
                  format,
                  quality,
                },
                audio: { bitrate: "128k" },
              }),
              rawResponse: true,
            },
            "ytmp3.gg Convert",
          );
          currentStatus = convRes.status;
          let conv = convRes.data;
          if (typeof conv === "string") {
            if (conv.trim().startsWith("<")) return null;
            conv = JSON.parse(conv);
          }
          if (!conv || conv.error || !conv.statusUrl) return null;
          let downloadUrl = null,
            attempts = 0;
          while (!downloadUrl && attempts < 30) {
            await new Promise((r) => setTimeout(r, 1500));
            const pollData = await scraperFetch(
              {
                url: conv.statusUrl,
                headers,
              },
              "ytmp3.gg Status",
            );
            attempts++;
            if (pollData && pollData.status === "completed" && pollData.downloadUrl) {
              downloadUrl = pollData.downloadUrl;
              break;
            }
            if (pollData && (pollData.status === "error" || pollData.status === "failed"))
              break;
          }
          return downloadUrl
            ? { url: downloadUrl, quality: conv.selectedQuality || quality }
            : null;
        } catch (e) {
          return null;
        }
      };

      const downloads = [];
      const tiers = ["720p", "360p"];

      // Run sequential requests to avoid convert1s concurrency limits
      for (const q of tiers) {
        const r = await runConvert("mp4", q);
        if (r && r.url) {
          downloads.push({ type: `MP4 ${r.quality || q}`, url: r.url });
        }
        await new Promise((res) => setTimeout(res, 300));
      }

      const mp3 = await runConvert("mp3", "");
      if (mp3 && mp3.url) {
        downloads.push({ type: "MP3", url: mp3.url });
      }

      if (downloads.length > 0) {
        _ytSource = null;
        return createScraperResult(true, { ...meta, downloads, sourceUrl: url });
      }

      console.warn("[ytmp3.gg] Failed, falling back to ytmp3.mobi...");
      _ytSource = "mobi";
      return await scrapeYouTube(url);
    }

    if (_ytSource === "mobi") {
      const headers = {
        Origin: "https://ytmp3.mobi",
        Referer: "https://ytmp3.mobi/",
        "User-Agent": CHROME_UA,
      };
      const initData = await scraperFetch(
        {
          url: "https://a.ymcdn.org/api/v1/init?p=y&23=1llum1n471",
          headers,
        },
        "ytmp3.mobi Init",
      );
      if (!initData || initData.error) throw new Error("Init failed");
      const fetchSingle = async (format) => {
        const convData = await scraperFetch(
          {
            url: `${initData.convertURL}&v=${videoId}&f=${format}`,
            headers,
          },
          "ytmp3.mobi Convert",
        );
        if (!convData || convData.error) return null;
        let progress = 0,
          dlUrl = convData.downloadURL,
          progUrl = convData.progressURL;
        let attempts = 0;
        while (progress < 3 && attempts < 15) {
          await new Promise((r) => setTimeout(r, 2000));
          const progData = await scraperFetch(
            { url: progUrl, headers },
            "ytmp3.mobi Progress",
          );
          if (!progData || progData.error) break;
          progress = progData.progress;
          if (progData.downloadURL) dlUrl = progData.downloadURL;
          if (progress === 4) break;
          attempts++;
        }
        if (dlUrl && dlUrl.startsWith("//")) dlUrl = "https:" + dlUrl;
        if (dlUrl && dlUrl.startsWith("/"))
          dlUrl = "https://ytmp3.mobi" + dlUrl;
        return dlUrl;
      };
      const [mp4Url, mp3Url] = await Promise.all([
        fetchSingle("mp4"),
        fetchSingle("mp3"),
      ]);
      const downloads = [];
      if (mp4Url) downloads.push({ type: "MP4", url: mp4Url });
      if (mp3Url) downloads.push({ type: "MP3", url: mp3Url });
      if (!downloads.length)
        throw new Error("Failed to get download links. Try again.");
      _ytSource = null;
      return createScraperResult(true, { ...meta, downloads, sourceUrl: url });
    }

    throw new Error("Invalid source selected");
  } catch (err) {
    _ytSource = null;
    return createScraperResult(false, err.message, currentStatus);
  }
}
