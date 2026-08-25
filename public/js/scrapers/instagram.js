import {
  CHROME_UA,
  SAFARI_MOBILE_UA,
  getCookiesFromHeaders,
  serializeData,
} from "../utils/index.js";
import { getCleanUrl } from "../utils/urlUtils.js";
import { scraperFetch, createScraperResult } from "./httpHelper.js";

export let _igSource = null;
export function setInstagramSource(src) {
  _igSource = src;
}

async function scrapeInstagramEmbedDirect(cleanUrl) {
  try {
    const shortcodeMatch = cleanUrl.match(
      /(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/,
    );
    if (!shortcodeMatch) return null;
    const shortcode = shortcodeMatch[1];
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;

    const res = await scraperFetch(
      {
        url: embedUrl,
        headers: {
          "User-Agent": SAFARI_MOBILE_UA,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        rawResponse: true,
      },
      "Instagram Direct Embed",
    );

    if (!res || !res.data) return null;
    const htmlText = typeof res.data === "string" ? res.data : String(res.data);
    const unescaped = htmlText.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    const idx = unescaped.indexOf('"shortcode_media":');
    if (idx === -1) return null;
    const start = idx + '"shortcode_media":'.length;
    let depth = 0;
    let end = -1;

    for (let i = start; i < unescaped.length; i++) {
      const char = unescaped[i];
      if (char === "{") depth++;
      else if (char === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }

    if (end === -1) return null;
    const rawJson = unescaped.slice(start, end);
    const media = JSON.parse(rawJson);

    const caption =
      media.edge_media_to_caption?.edges[0]?.node?.text || "Instagram Media";
    const downloads = [];

    if (media.edge_sidecar_to_children?.edges) {
      media.edge_sidecar_to_children.edges.forEach((edge, i) => {
        const n = edge.node;
        const mediaUrl = n.video_url || n.display_url;
        if (mediaUrl) {
          downloads.push({
            url: mediaUrl,
            type: n.is_video ? "VIDEO" : "IMAGE",
            quality: n.is_video ? `HD Video ${i + 1}` : `HD Photo ${i + 1}`,
            thumbnail: n.display_url || mediaUrl,
          });
        }
      });
    } else {
      const mediaUrl = media.video_url || media.display_url;
      if (mediaUrl) {
        downloads.push({
          url: mediaUrl,
          type: media.is_video ? "VIDEO" : "IMAGE",
          quality: media.is_video ? "HD Video" : "HD Photo",
          thumbnail: media.display_url || mediaUrl,
        });
      }
    }

    if (!downloads.length) return null;
    return createScraperResult(true, {
      title: caption.slice(0, 80),
      thumbnail: downloads[0].thumbnail || downloads[0].url,
      downloads,
      sourceUrl: cleanUrl,
    });
  } catch (err) {
    console.warn("[IG Embed Direct] Failed:", err);
    return null;
  }
}

export async function scrapeInstagram(url) {
  let currentStatus = null;
  try {
    const cleanUrl = getCleanUrl(url).split("?")[0];
    if (!_igSource) return { requireSource: true };

    if (_igSource === "downreels") {
      try {
        const res = await scraperFetch(
          {
            url: "https://api.zoraahub.com/fetch.php",
            method: "POST",
            data: { url: cleanUrl },
            headers: {
              "Content-Type": "application/json",
              "User-Agent": CHROME_UA,
              Origin: "https://downreels.com",
              Referer: "https://downreels.com/",
            },
            rawResponse: true,
          },
          "DownReels",
        );
        currentStatus = res.status;
        let data = res.data;

        if (typeof data === "string") {
          if (data.trim().startsWith("<")) {
            throw new Error("DownReels server returned HTML error page.");
          }
          data = JSON.parse(data);
        }

        if (data && data.status === "ok") {
          const items = data.videos || data.images || [];
          const downloads = items.map((item) => ({
            url: item.url,
            type: item.isVideo ? "VIDEO" : "IMAGE",
            quality: item.quality || "HD",
            thumbnail: item.thumb || null,
          }));
          if (downloads.length) {
            _igSource = null;
            return createScraperResult(true, {
              title: "Instagram Media",
              thumbnail: data.thumbnail || downloads[0].url,
              downloads,
              sourceUrl: url,
            });
          }
        }
      } catch (err) {
        console.warn("[DownReels] Failed, trying Direct Embed fallback...", err);
      }

      const embedResult = await scrapeInstagramEmbedDirect(cleanUrl);
      if (embedResult) {
        _igSource = null;
        return embedResult;
      }

      throw new Error("Failed to fetch media from Server 2.");
    }

    if (_igSource === "indown") {
      try {
        const desktopUA = CHROME_UA;
        const acceptHeader =
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";

        const r1 = await scraperFetch(
          {
            url: "https://indown.io/en2",
            headers: {
              "User-Agent": desktopUA,
              Accept: acceptHeader,
            },
            rawResponse: true,
          },
          "Indown Init",
        );
        currentStatus = r1.status;
        const parser = new DOMParser();
        const doc1 = parser.parseFromString(r1.data, "text/html");
        const cookies = getCookiesFromHeaders(r1.headers);
        const token = doc1.querySelector('input[name="_token"]')?.value;

        if (token) {
          const r2 = await scraperFetch(
            {
              url: "https://indown.io/download",
              method: "POST",
              data: serializeData({
                link: cleanUrl,
                _token: token,
                referer: "https://indown.io/en2",
                locale: "en",
              }),
              headers: {
                Cookie: cookies,
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": desktopUA,
                Accept: acceptHeader,
                Referer: "https://indown.io/en2",
                Origin: "https://indown.io",
              },
              rawResponse: true,
            },
            "Indown Download",
          );
          currentStatus = r2.status;

          const doc2 = parser.parseFromString(r2.data, "text/html");
          const downloadsMap = new Map();

          const addLink = (a) => {
            const href = a.getAttribute("href");
            if (
              !href ||
              !href.startsWith("http") ||
              href.includes("indown.io") ||
              href.includes("ads")
            )
              return;
            const key = href.split("?")[0];
            if (downloadsMap.has(key)) return;
            const text = (a.textContent || "").toUpperCase();
            const isImage =
              /\.(jpe?g|png|webp|gif)(\?|$)/i.test(key) ||
              text.includes("IMAGE") ||
              text.includes("PHOTO");
            const type = isImage ? "IMAGE" : "VIDEO";
            downloadsMap.set(key, { type, url: href });
          };

          const btnLinks = doc2.querySelectorAll(
            ".btn-group-vertical a, a.btn-color, a.btn, a[href*='cdninstagram'], a[href*='fbcdn']",
          );
          if (btnLinks.length > 0) {
            btnLinks.forEach(addLink);
          }

          if (downloadsMap.size === 0) {
            const resultArea = doc2.querySelector(".container .row") || doc2;
            resultArea.querySelectorAll("a[href]").forEach(addLink);
          }

          const downloads = [...downloadsMap.values()];

          if (downloads.length > 0) {
            let thumbnail = downloads[0].url;
            const video = doc2.querySelector("video.img-fluid");
            if (video) thumbnail = video.getAttribute("poster") || thumbnail;

            _igSource = null;
            return createScraperResult(true, {
              title: "Instagram Content",
              thumbnail,
              downloads,
              sourceUrl: url,
            });
          }
        }
      } catch (err) {
        console.warn("[Indown] Failed, trying Direct Embed fallback...", err);
      }

      const embedResult = await scrapeInstagramEmbedDirect(cleanUrl);
      if (embedResult) {
        _igSource = null;
        return embedResult;
      }

      throw new Error(
        "Media links not found. Post might be private or invalid.",
      );
    }

    throw new Error("Invalid source selected.");
  } catch (err) {
    _igSource = null;
    return createScraperResult(false, err.message, currentStatus);
  }
}
