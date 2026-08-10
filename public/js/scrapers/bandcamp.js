import {
  CHROME_UA,
  getCookiesFromHeaders,
  serializeData,
} from "../utils/index.js";
import { scraperFetch, createScraperResult } from "./httpHelper.js";

export async function scrapeBandcamp(url) {
  let currentStatus = null;
  try {
    const headers = {
      "User-Agent": CHROME_UA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    };

    const r1 = await scraperFetch(
      {
        url: "https://bandcampdownloader.app/",
        headers,
        rawResponse: true,
      },
      "Bandcamp Main",
    );
    currentStatus = r1.status;
    const cookies = getCookiesFromHeaders(r1.headers);
    const parser = new DOMParser();
    const doc1 = parser.parseFromString(r1.data, "text/html");

    const csrfInput = doc1.querySelector(
      'form[name="submitbcurl"] input[type="hidden"]',
    );
    const csrfName = csrfInput?.getAttribute("name");
    const csrfValue = csrfInput?.getAttribute("value");

    if (!csrfName || !csrfValue) throw new Error("CSRF token not found.");

    const r2Data = await scraperFetch(
      {
        url: "https://bandcampdownloader.app/action",
        method: "POST",
        data: serializeData({ url, [csrfName]: csrfValue }),
        headers: {
          ...headers,
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookies,
        },
      },
      "Bandcamp Action",
    );

    if (r2Data.error)
      throw new Error(r2Data.message || "Failed to process URL.");
    if (!r2Data.success || !r2Data.html)
      throw new Error("Unexpected response.");

    const doc2 = parser.parseFromString(r2Data.html, "text/html");
    const trackForms = doc2.querySelectorAll('form[name="submitapurl"]');
    if (trackForms.length === 0) throw new Error("No tracks found.");

    const firstDataB64 =
      trackForms[0].querySelector('input[name="data"]')?.value;
    const firstMeta = JSON.parse(atob(firstDataB64));

    const downloads = [];
    const isAlbum = trackForms.length > 1;

    for (let i = 0; i < trackForms.length; i++) {
      const form = trackForms[i];
      const dataVal = form.querySelector('input[name="data"]')?.value;
      const baseVal = form.querySelector('input[name="base"]')?.value;
      const tokenVal = form.querySelector('input[name="token"]')?.value;

      const r3Data = await scraperFetch(
        {
          url: "https://bandcampdownloader.app/action/track",
          method: "POST",
          data: serializeData({
            data: dataVal,
            base: baseVal,
            token: tokenVal,
            type: "320",
          }),
          headers: {
            ...headers,
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: cookies,
          },
        },
        "Bandcamp Track",
      );

      if (r3Data.error) continue;

      const doc3 = parser.parseFromString(r3Data.data || r3Data, "text/html");
      doc3.querySelectorAll("a.abutton").forEach((a) => {
        const href = a.getAttribute("href");
        const label = a.textContent.trim();
        if (href && href.includes("/dl?token=")) {
          const prefix = isAlbum
            ? `${(i + 1).toString().padStart(2, "0")}. `
            : "";
          downloads.push({
            type: `${prefix}${label}`,
            url: `https://bandcampdownloader.app${href}`,
          });
        }
      });
    }

    if (downloads.length === 0) throw new Error("Download links not found.");

    return createScraperResult(true, {
      title: isAlbum ? firstMeta.album || firstMeta.name : firstMeta.name,
      thumbnail: firstMeta.cover,
      downloads,
      sourceUrl: url,
    });
  } catch (err) {
    return createScraperResult(false, err.message, currentStatus);
  }
}
