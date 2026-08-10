import { getCleanUrl } from "../utils/urlUtils.js";
import { scraperFetch, createScraperResult } from "./httpHelper.js";

async function sha256(message) {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function scrapeRedNote(url) {
  try {
    let cleanUrl = getCleanUrl(url);

    if (cleanUrl.includes("xhslink.com") || cleanUrl.includes("xhslink.cn")) {
      try {
        const redirectRes = await scraperFetch(
          {
            url: cleanUrl,
            rawResponse: true,
          },
          "RedNote Redirect",
        );
        if (redirectRes.url) {
          cleanUrl = redirectRes.url;
        } else {
          const html = redirectRes.data || "";
          const canonicalMatch =
            html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/) ||
            html.match(
              /href="(https?:\/\/(?:www\.)?xiaohongshu\.com\/explore\/[^"]+)"/,
            );
          if (canonicalMatch) {
            cleanUrl = canonicalMatch[1];
          }
        }
      } catch (e) {
        console.error("RedNote redirect resolve failed:", e);
      }
    }

    const timestamp = Date.now().toString();
    const secret = "3HT8hjE79L";
    const signStr = "en" + timestamp + secret + "url=" + cleanUrl;
    const sign = await sha256(signStr);

    const responseData = await scraperFetch(
      {
        url: "https://api.seekin.ai/ikool/media/download",
        method: "POST",
        data: { url: cleanUrl },
        headers: {
          "Content-Type": "application/json",
          lang: "en",
          timestamp: timestamp,
          sign: sign,
        },
      },
      "RedNote",
    );

    if (!responseData || responseData.code !== "0000" || !responseData.data) {
      throw new Error(responseData?.msg || "Failed to process RedNote URL.");
    }

    const info = responseData.data;
    const title = info.title || "RedNote_Media";
    const thumbnail = info.imageUrl || null;
    const downloads = [];

    if (info.medias && info.medias.length > 0) {
      for (const item of info.medias) {
        downloads.push({
          url: item.url,
          type: "VIDEO",
          quality: item.format || "HD",
        });
      }
    } else if (info.images && info.images.length > 0) {
      for (const item of info.images) {
        downloads.push({
          url: item.url || item,
          type: "IMAGE",
          quality: "HD",
        });
      }
    }

    if (downloads.length === 0) throw new Error("No media found on this URL.");
    return createScraperResult(true, {
      title,
      thumbnail,
      downloads,
      sourceUrl: url,
    });
  } catch (e) {
    return createScraperResult(false, e.message);
  }
}
