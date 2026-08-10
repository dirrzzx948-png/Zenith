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
          const conv =
            typeof convRes.data === "string"
              ? JSON.parse(convRes.data)
              : convRes.data;
          if (conv.error || !conv.statusUrl) return null;
          let downloadUrl = null,
            attempts = 0;
          while (!downloadUrl && attempts < 30) {
            await new Promise((r) => setTimeout(r, 2000));
            const pollData = await scraperFetch(
              {
                url: conv.statusUrl,
                headers,
              },
              "ytmp3.gg Status",
            );
            attempts++;
            if (pollData.status === "completed" && pollData.downloadUrl) {
              downloadUrl = pollData.downloadUrl;
              break;
            }
            if (pollData.status === "error" || pollData.status === "failed")
              break;
          }
          return downloadUrl
            ? { url: downloadUrl, quality: conv.selectedQuality || quality }
            : null;
        } catch (e) {
          return null;
        }
      };
      const tiers = ["1080p", "720p", "480p", "360p"];
      const [mp3, ...mp4s] = await Promise.all([
        runConvert("mp3", ""),
        ...tiers.map((q) => runConvert("mp4", q)),
      ]);
      const downloads = [];
      mp4s.forEach((r, i) => {
        if (r) downloads.push({ type: `MP4 ${tiers[i]}`, url: r.url });
      });
      if (mp3) downloads.push({ type: "MP3", url: mp3.url });
      if (!downloads.length)
        throw new Error("Failed to get download links. Try again.");
      _ytSource = null;
      return createScraperResult(true, { ...meta, downloads, sourceUrl: url });
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
