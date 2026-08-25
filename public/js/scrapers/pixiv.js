import { CHROME_UA } from "../utils/index.js";
import { scraperFetch, createScraperResult } from "./httpHelper.js";

export async function scrapePixiv(url) {
  let currentStatus = null;
  try {
    const illustIdMatch =
      url.match(/artworks\/(\d+)/) || url.match(/illust_id=(\d+)/);
    if (!illustIdMatch) throw new Error("Invalid Pixiv URL.");
    const illustId = illustIdMatch[1];

    let illustData = null;

    // 1. Try fetching official AJAX API
    try {
      const res = await scraperFetch(
        {
          url: `https://www.pixiv.net/ajax/illust/${illustId}?lang=en`,
          headers: {
            "User-Agent": CHROME_UA,
            Referer: "https://www.pixiv.net/",
          },
          rawResponse: true,
        },
        "Pixiv Ajax API",
      );
      currentStatus = res.status;
      let resData = res.data;
      if (typeof resData === "string") {
        try {
          resData = JSON.parse(resData);
        } catch (e) {}
      }
      if (resData && !resData.error && resData.body) {
        illustData = resData.body;
      }
    } catch (e) {}

    // 2. If AJAX API fails (R-18 / Login restriction), scrape HTML meta-preload-data
    if (!illustData) {
      try {
        const html = await scraperFetch(
          {
            url: `https://www.pixiv.net/en/artworks/${illustId}`,
            headers: {
              "User-Agent": CHROME_UA,
              "Accept-Language": "en-US,en;q=0.9",
            },
            parseJson: false,
          },
          "Pixiv Artwork Page",
        );
        if (html && typeof html === "string") {
          const match =
            html.match(/id="meta-preload-data"\s+content='([^']+)'/i) ||
            html.match(/id="meta-preload-data"\s+content="([^"]+)"/i);
          if (match && match[1]) {
            const rawContent = match[1]
              .replace(/&quot;/g, '"')
              .replace(/&amp;/g, "&");
            const preload = JSON.parse(rawContent);
            if (preload && preload.illust && preload.illust[illustId]) {
              illustData = preload.illust[illustId];
            }
          }
        }
      } catch (e) {
        console.warn("Could not parse meta-preload-data:", e);
      }
    }

    // 3. Determine if Ugoira
    let isUgoira = false;
    if (illustData) {
      isUgoira =
        String(illustData.illustType) === "2" ||
        illustData.illustType == 2 ||
        String(illustData.illust_type) === "2" ||
        illustData.type === "ugoira" ||
        (illustData.urls &&
          illustData.urls.original &&
          illustData.urls.original.includes("ugoira"));
    }

    // Double check via ugoira_meta endpoint
    if (!isUgoira) {
      try {
        const metaData = await scraperFetch(
          {
            url: `https://www.pixiv.net/ajax/illust/${illustId}/ugoira_meta?lang=en`,
            headers: {
              "User-Agent": CHROME_UA,
              Referer: "https://www.pixiv.net/",
            },
          },
          "Pixiv Ugoira Meta",
        );
        if (
          metaData &&
          !metaData.error &&
          metaData.body &&
          (metaData.body.originalSrc ||
            (metaData.body.frames && metaData.body.frames.length > 0))
        ) {
          isUgoira = true;
        }
      } catch (e) {}
    }

    const title =
      illustData?.title || illustData?.illustTitle
        ? `${illustData.title || illustData.illustTitle} by ${
            illustData.userName || illustData.userAccount || "Unknown"
          }`
        : "Pixiv Artwork";

    const downloads = [];

    if (isUgoira) {
      let zipUrl = null;
      try {
        const metaData = await scraperFetch(
          {
            url: `https://www.pixiv.net/ajax/illust/${illustId}/ugoira_meta?lang=en`,
            headers: {
              "User-Agent": CHROME_UA,
              Referer: "https://www.pixiv.net/",
            },
          },
          "Pixiv Ugoira Zip",
        );
        if (metaData && !metaData.error && metaData.body) {
          zipUrl = metaData.body.originalSrc || metaData.body.src;
        }
      } catch (e) {}

      const ugoiraThumb = `https://pixiv.re/${illustId}.gif`;
      downloads.push({
        type: "UGOIRA (MP4)",
        url: `https://ugoira.com/api/mp4/${illustId}`,
        thumbnail: ugoiraThumb,
      });
      downloads.push({
        type: "UGOIRA (GIF)",
        url: ugoiraThumb,
        thumbnail: ugoiraThumb,
      });
      downloads.push({
        type: "UGOIRA (ZIP)",
        url:
          zipUrl ||
          `https://i.pximg.net/img-zip-ugoira/img/${illustId}_ugoira1920x1080.zip`,
        thumbnail: ugoiraThumb,
      });
    } else {
      const pageCount = illustData?.pageCount || 1;
      const originalUrl = illustData?.urls?.original;
      if (originalUrl) {
        for (let i = 0; i < pageCount; i++) {
          let type = pageCount > 1 ? `PAGE ${i + 1}` : "IMAGE";
          let pageUrl = originalUrl.replace("_p0", `_p${i}`);
          pageUrl = pageUrl.replace("i.pximg.net", "i.pixiv.re");
          let pageThumb = pageUrl;
          downloads.push({ type, url: pageUrl, thumbnail: pageThumb });
        }
      } else {
        downloads.push({
          type: "IMAGE / PAGE 1",
          url: `https://pixiv.re/${illustId}.jpg`,
          thumbnail: `https://pixiv.re/${illustId}.jpg`,
        });
        for (let i = 2; i <= pageCount; i++) {
          downloads.push({
            type: `PAGE ${i}`,
            url: `https://pixiv.re/${illustId}-${i}.jpg`,
            thumbnail: `https://pixiv.re/${illustId}-${i}.jpg`,
          });
        }
      }
    }

    const thumb = isUgoira
      ? `https://pixiv.re/${illustId}.gif`
      : illustData?.urls?.regular?.replace("i.pximg.net", "i.pixiv.re") ||
        illustData?.urls?.original?.replace("i.pximg.net", "i.pixiv.re") ||
        `https://pixiv.re/${illustId}.jpg`;

    return createScraperResult(
      true,
      {
        title,
        thumbnail: thumb,
        downloads,
        sourceUrl: url,
      },
      currentStatus,
    );
  } catch (err) {
    return createScraperResult(false, err.message, currentStatus);
  }
}
