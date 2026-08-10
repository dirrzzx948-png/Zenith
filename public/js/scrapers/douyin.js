import { getCleanUrl } from "../utils/urlUtils.js";
import { scraperFetch, createScraperResult } from "./httpHelper.js";

export async function scrapeDouyin(url) {
  try {
    if (!url || typeof url !== "string") throw new Error("Invalid URL.");
    const clean = getCleanUrl(url);

    const mobileUA =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1";
    const html = await scraperFetch(
      {
        url: clean,
        headers: {
          "User-Agent": mobileUA,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        parseJson: false,
      },
      "Douyin",
    );
    const htmlStr = typeof html === "string" ? html : "";
    const marker = "window._ROUTER_DATA =";
    const startIdx = htmlStr.indexOf(marker);
    if (startIdx === -1) throw new Error("Could not find video data in page.");

    const slice = htmlStr.substring(startIdx + marker.length).trim();
    let braceCount = 0,
      inStr = false,
      strChar = null,
      escape = false,
      endIdx = -1;
    for (let i = 0; i < slice.length; i++) {
      const c = slice[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (inStr) {
        if (c === strChar) inStr = false;
        continue;
      }
      if (c === '"' || c === "'") {
        inStr = true;
        strChar = c;
        continue;
      }
      if (c === "{") braceCount++;
      else if (c === "}") {
        braceCount--;
        if (braceCount === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }
    if (endIdx === -1) throw new Error("Could not parse router data.");

    const routerData = JSON.parse(slice.substring(0, endIdx));
    const loaderData = routerData.loaderData || {};
    let videoInfoRes = null;
    for (const key in loaderData) {
      if (loaderData[key] && loaderData[key].videoInfoRes) {
        videoInfoRes = loaderData[key].videoInfoRes;
        break;
      }
    }
    if (
      !videoInfoRes ||
      !videoInfoRes.item_list ||
      videoInfoRes.item_list.length === 0
    ) {
      throw new Error("No video item found in page data.");
    }

    const item = videoInfoRes.item_list[0];
    const title = item.desc || "Douyin Content";
    const author = item.author ? item.author.nickname : "Douyin User";
    const downloads = [];

    if (item.images && item.images.length > 0) {
      item.images.forEach((img) => {
        const imgUrl = img.url_list?.[0];
        if (imgUrl) {
          downloads.push({
            type: "PHOTO",
            url: imgUrl,
            isMirror: false,
          });
        }
      });
    } else {
      const watermarkUrl =
        item.video && item.video.play_addr
          ? item.video.play_addr.url_list?.[0]
          : null;
      if (!watermarkUrl) throw new Error("No video URL found.");

      let videoId = null;
      try {
        videoId = new URL(watermarkUrl).searchParams.get("video_id");
      } catch (e) {}
      if (!videoId) {
        const m = watermarkUrl.match(/video_id=([^&]+)/);
        if (m) videoId = m[1];
      }
      const noWatermarkUrl = videoId
        ? `https://aweme.snssdk.com/aweme/v1/play/?video_id=${videoId}`
        : watermarkUrl;

      downloads.push(
        { type: "VIDEO", url: noWatermarkUrl, isMirror: false },
        { type: "VIDEO_WM", url: watermarkUrl, isMirror: true },
      );
    }

    if (downloads.length === 0) {
      throw new Error("No downloadable media found.");
    }

    return createScraperResult(true, {
      title,
      author,
      thumbnail:
        item.video?.cover?.url_list?.[0] ||
        item.images?.[0]?.url_list?.[0] ||
        null,
      downloads,
      sourceUrl: url,
    });
  } catch (e) {
    return createScraperResult(false, e.message);
  }
}
