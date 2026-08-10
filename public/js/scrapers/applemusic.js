import {
  CHROME_UA,
  getCookiesFromHeaders,
  serializeData,
} from "../utils/index.js";
import { scraperFetch, createScraperResult } from "./httpHelper.js";

export async function scrapeAppleMusic(url) {
  let currentStatus = null;
  try {
    const headers = {
      "User-Agent": CHROME_UA,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    };

    const r1 = await scraperFetch(
      {
        url: "https://aplmate.com/",
        headers: { ...headers, Accept: "text/html" },
        rawResponse: true,
      },
      "Aplmate Main",
    );
    currentStatus = r1.status;
    const cookies = getCookiesFromHeaders(r1.headers);

    const r2Data = await scraperFetch(
      {
        url: "https://aplmate.com/action/userverify",
        method: "POST",
        data: serializeData({ url }),
        headers: {
          ...headers,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Cookie: cookies,
        },
      },
      "Aplmate Verify",
    );

    const token = r2Data.success ? r2Data.token : null;
    if (!token) throw new Error(r2Data.message || "Verification failed.");

    const r3Data = await scraperFetch(
      {
        url: "https://aplmate.com/action",
        method: "POST",
        data: serializeData({ url, "cf-turnstile-response": token }),
        headers: {
          ...headers,
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookies,
        },
      },
      "Aplmate Action",
    );

    if (r3Data.error) throw new Error(r3Data.message || "Action failed.");

    const parser = new DOMParser();
    let finalHtml = r3Data.html;
    const doc2 = parser.parseFromString(finalHtml, "text/html");
    const form2 = doc2.querySelector('form[name="submitapurl"]');

    if (form2) {
      const data2 = {};
      form2.querySelectorAll("input").forEach((input) => {
        const name = input.getAttribute("name");
        const value = input.getAttribute("value") || "";
        if (name) data2[name] = value;
      });

      const r4Data = await scraperFetch(
        {
          url: "https://aplmate.com/action/track",
          method: "POST",
          data: serializeData(data2),
          headers: {
            ...headers,
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: cookies,
          },
        },
        "Aplmate Track",
      );
      finalHtml = r4Data.data || r4Data;
    }

    const doc3 = parser.parseFromString(finalHtml, "text/html");
    const title =
      doc3.querySelector(".hover-underline")?.textContent?.trim() ||
      doc3.querySelector("h3")?.textContent?.trim() ||
      "Apple Music Content";
    const artist = doc3.querySelector("p")?.textContent?.trim();
    const thumbnail = doc3.querySelector("img")?.getAttribute("src");
    const downloads = [];

    doc3.querySelectorAll("a").forEach((a) => {
      const href = a.getAttribute("href");
      const text = a.textContent.trim();
      if (
        href &&
        (href.includes("/dl?token=") || a.classList.contains("abutton"))
      ) {
        if (href.includes("ko-fi.com") || href.includes("premium.html")) return;
        if (text.toLowerCase().includes("another song")) return;
        downloads.push({
          type: text || "MP3",
          url: href.startsWith("http") ? href : "https://aplmate.com" + href,
        });
      }
    });

    return createScraperResult(true, {
      title: artist ? `${artist} - ${title}` : title,
      thumbnail,
      downloads,
      sourceUrl: url,
    });
  } catch (err) {
    return createScraperResult(false, err.message, currentStatus);
  }
}
