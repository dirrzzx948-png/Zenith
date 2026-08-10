import {
  CHROME_UA,
  getCookiesFromHeaders,
  serializeData,
} from "../utils/index.js";
import { getCleanUrl } from "../utils/urlUtils.js";
import { scraperFetch, createScraperResult } from "./httpHelper.js";

export let _igSource = null;
export function setInstagramSource(src) {
  _igSource = src;
}

export async function scrapeInstagram(url) {
  let currentStatus = null;
  try {
    const cleanUrl = getCleanUrl(url).split("?")[0];
    if (!_igSource) return { requireSource: true };

    if (_igSource === "downreels") {
      const res = await scraperFetch(
        {
          url: "https://api.zoraahub.com/fetch.php",
          method: "POST",
          data: { url },
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
      const data =
        typeof res.data === "string" ? JSON.parse(res.data) : res.data;
      if (!data || data.status !== "ok")
        throw new Error(data?.message || "Failed to fetch from DownReels.");
      const items = data.videos || data.images || [];
      const downloads = items.map((item) => ({
        url: item.url,
        type: item.isVideo ? "VIDEO" : "IMAGE",
        quality: item.quality || "HD",
        thumbnail: item.thumb || null,
      }));
      if (!downloads.length)
        throw new Error("No download links found from DownReels.");
      _igSource = null;
      return createScraperResult(true, {
        title: "Instagram Media",
        thumbnail: data.thumbnail || downloads[0].url,
        downloads,
        sourceUrl: url,
      });
    }

    if (_igSource === "indown") {
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
      if (!token) throw new Error("Scraper outdated (token missing).");

      const r2 = await scraperFetch(
        {
          url: "https://indown.io/download",
          method: "POST",
          data: serializeData({ link: cleanUrl, _token: token, a: "a" }),
          headers: {
            Cookie: cookies,
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": desktopUA,
            Accept: acceptHeader,
          },
          rawResponse: true,
        },
        "Indown Download",
      );
      currentStatus = r2.status;

      const doc2 = parser.parseFromString(r2.data, "text/html");
      const errorMsg = doc2
        .querySelector("#error .modal-body")
        ?.textContent?.trim();
      if (errorMsg && errorMsg.toLowerCase().includes("not found")) {
        throw new Error("Post not found on Indown.");
      }

      let thumbnail = null;
      const video = doc2.querySelector("video.img-fluid");
      if (video) thumbnail = video.getAttribute("poster");

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

      if (downloads.length === 0)
        throw new Error(
          "Media links not found. Post might be private or invalid.",
        );
      if (!thumbnail && downloads.length > 0) thumbnail = downloads[0].url;

      _igSource = null;
      return createScraperResult(true, {
        title: "Instagram Content",
        thumbnail,
        downloads,
        sourceUrl: url,
      });
    }

    throw new Error("Invalid source selected.");
  } catch (err) {
    _igSource = null;
    return createScraperResult(false, err.message, currentStatus);
  }
}
