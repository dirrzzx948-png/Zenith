import { CHROME_UA, getCookiesFromHeaders } from "../utils/index.js";
import { scraperFetch, createScraperResult } from "./httpHelper.js";

export async function scrapePinterest(url) {
  let currentStatus = null;
  try {
    const r1 = await scraperFetch(
      {
        url: "https://pindown.io/",
        headers: { "User-Agent": CHROME_UA },
        rawResponse: true,
      },
      "Pindown Main",
    );
    currentStatus = r1.status;
    const cookies = getCookiesFromHeaders(r1.headers);
    const parser = new DOMParser();
    const doc1 = parser.parseFromString(r1.data, "text/html");

    const tokenInput = doc1.querySelector(
      'input[type="hidden"]:not([name="lang"])',
    );
    const tokenName = tokenInput?.getAttribute("name");
    const tokenValue = tokenInput?.getAttribute("value");

    if (!tokenName || !tokenValue)
      throw new Error("Pinterest token not found.");

    const r2Data = await scraperFetch(
      {
        url: "https://pindown.io/action",
        method: "POST",
        data: { url, [tokenName]: tokenValue, lang: "en" },
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          Cookie: cookies,
          "User-Agent": CHROME_UA,
        },
      },
      "Pindown Action",
    );

    const doc2 = parser.parseFromString(r2Data.html || "", "text/html");
    const downloads = [];
    doc2.querySelectorAll(".columns .column").forEach((el) => {
      const title = el.querySelector(".is-size-6")?.textContent?.trim();
      const dlUrl = el.querySelector(".button")?.getAttribute("href");
      if (dlUrl) downloads.push({ type: title || "DOWNLOAD", url: dlUrl });
    });

    return createScraperResult(true, {
      title: doc2.querySelector("h3")?.textContent?.trim() || "Pinterest",
      thumbnail: doc2.querySelector(".image img")?.getAttribute("src"),
      downloads,
      sourceUrl: url,
    });
  } catch (err) {
    return createScraperResult(false, err.message, currentStatus);
  }
}
