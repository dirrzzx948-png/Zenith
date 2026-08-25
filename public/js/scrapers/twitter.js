import {
  CHROME_UA,
  getCookiesFromHeaders,
  serializeData,
} from "../utils/index.js";
import { getCleanUrl } from "../utils/urlUtils.js";
import { scraperFetch, createScraperResult } from "./httpHelper.js";

export let _twSource = null;
export function setTwitterSource(src) {
  _twSource = src;
}

export async function scrapeTwitter(url) {
  let currentStatus = null;
  try {
    const cleanUrl = getCleanUrl(url).split("?")[0];
    if (!_twSource) return { requireSource: true };

    const formatResolutionLabel = (rawText, qualityText, url = "") => {
      const text = (rawText || "") + " " + (qualityText || "");
      const urlMatch = (url || "").match(/\/vid\/(\d+x\d+)\//i);
      if (urlMatch) {
        return urlMatch[1].toLowerCase();
      }
      const match = text.match(/(\d+\s*[xX]\s*\d+|\d+\s*p)/i);
      if (match) {
        return match[1].replace(/\s+/g, "").toLowerCase();
      }
      const clean = text
        .replace(/download|video|mp4|get|premium|for|\$|\d+\.\d+|\:/gi, "")
        .trim();
      return clean || "MP4";
    };

    const isPaywallOrInvalid = (href, labelText) => {
      if (!href || !href.startsWith("http")) return true;
      const lowerHref = href.toLowerCase();
      const lowerLabel = (labelText || "").toLowerCase();
      if (
        lowerHref.includes("checkout") ||
        lowerHref.includes("stripe") ||
        lowerHref.includes("buy") ||
        lowerHref.includes("premium") ||
        lowerLabel.includes("$") ||
        lowerLabel.includes("for $") ||
        lowerLabel.includes("premium") ||
        lowerLabel.includes("paywall")
      ) {
        return true;
      }
      return false;
    };

    if (_twSource === "tvd") {
      const twitterUrl = cleanUrl.replace(
        /https:\/\/(x|fixupx|fxtwitter|vxtwitter|nitter)\.com/g,
        "https://twitter.com",
      );
      const r1 = await scraperFetch(
        {
          url: "https://twittervideodownloader.com/",
          headers: { "User-Agent": CHROME_UA },
          rawResponse: true,
        },
        "TVD Main",
      );
      currentStatus = r1.status;
      const parser = new DOMParser();
      const doc1 = parser.parseFromString(r1.data, "text/html");
      const csrf = doc1.querySelector(
        'input[name="csrfmiddlewaretoken"]',
      )?.value;
      const gql = doc1.querySelector('input[name="gql"]')?.value || "";
      const cookies = getCookiesFromHeaders(r1.headers);

      if (!csrf)
        throw new Error(
          "Could not find CSRF token from TwitterVideoDownloader.",
        );

      const r2 = await scraperFetch(
        {
          url: "https://twittervideodownloader.com/download",
          method: "POST",
          data: serializeData({
            tweet: twitterUrl,
            csrfmiddlewaretoken: csrf,
            gql: gql,
          }),
          headers: {
            Cookie: cookies,
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": CHROME_UA,
            Referer: "https://twittervideodownloader.com/",
          },
          rawResponse: true,
        },
        "TVD Download",
      );
      currentStatus = r2.status;

      const doc2 = parser.parseFromString(r2.data, "text/html");
      const rawDownloads = [];

      doc2.querySelectorAll(".card-body").forEach((card) => {
        const qualityText =
          card.querySelector(".card-text")?.textContent?.trim() || "";
        card.querySelectorAll("a.btn-download, a.btn").forEach((btn) => {
          const href = btn.getAttribute("href");
          const btnText = btn.textContent.trim();
          const fullText = `${btnText} ${qualityText}`;
          if (!isPaywallOrInvalid(href, fullText)) {
            const label = formatResolutionLabel(btnText, qualityText, href);
            if (!rawDownloads.some((d) => d.url === href)) {
              const isImg =
                /\.(jpe?g|png|webp)(\?|$)/i.test(href) ||
                label === "IMAGE" ||
                label === "PHOTO";
              rawDownloads.push({ type: label, url: href, isMirror: false });
            }
          }
        });
      });

      if (rawDownloads.length === 0) {
        doc2
          .querySelectorAll('a[href*="video.twimg.com"], a[href*="twimg.com"]')
          .forEach((a) => {
            const href = a.getAttribute("href");
            const text = a.textContent.trim();
            if (
              !isPaywallOrInvalid(href, text) &&
              !rawDownloads.some((d) => d.url === href)
            ) {
              const label = formatResolutionLabel(text, "", href);
              rawDownloads.push({ type: label, url: href, isMirror: false });
            }
          });
      }

      if (rawDownloads.length === 0)
        throw new Error("No free video links found on TVD.");

      const thumbnail =
        doc2
          .querySelector(
            "img[src*='twimg.com'], img[src*='pbs.twimg.com'], .card img",
          )
          ?.getAttribute("src") ||
        doc2.querySelector("video")?.getAttribute("poster") ||
        null;

      // Strictly return only 1 valid free download link specifically for TVD
      const downloads = rawDownloads.slice(0, 1);

      _twSource = null;
      return createScraperResult(true, {
        title: "Twitter/X Video",
        thumbnail,
        downloads,
        sourceUrl: url,
      });
    }

    if (_twSource === "tweeload") {
      const twitterUrl = cleanUrl.replace(
        /https:\/\/(fixupx|fxtwitter|vxtwitter|nitter|twitter)\.com/g,
        "https://x.com",
      );
      const r1 = await scraperFetch(
        {
          url: "https://tweeload.com/en",
          headers: { "User-Agent": CHROME_UA },
          rawResponse: true,
        },
        "Tweeload Init",
      );
      currentStatus = r1.status;

      const parser = new DOMParser();

      const r2 = await scraperFetch(
        {
          url: "https://tweeload.com/en/download",
          method: "POST",
          data: serializeData({ url: twitterUrl }),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": CHROME_UA,
          },
          rawResponse: true,
        },
        "Tweeload Download",
      );
      currentStatus = r2.status;

      const doc2 = parser.parseFromString(r2.data, "text/html");
      const downloads = [];

      doc2
        .querySelectorAll(".download__item__info__actions tbody tr")
        .forEach((tr) => {
          const tds = tr.querySelectorAll("td");
          const quality = tds[0]?.textContent?.trim();
          let dlUrl = tr
            .querySelector("a.download__item__info__actions__button")
            ?.getAttribute("href");
          if (dlUrl) {
            if (dlUrl.startsWith("/")) dlUrl = "https://tweeload.com" + dlUrl;
            if (!isPaywallOrInvalid(dlUrl, quality)) {
              const label = formatResolutionLabel(quality, "", dlUrl);
              const isImg =
                /\.(jpe?g|png|webp)(\?|$)/i.test(dlUrl) ||
                label === "IMAGE" ||
                label === "PHOTO";
              const isMirror = isImg
                ? false
                : downloads.some((d) => d.type !== "IMAGE" && d.type !== "PHOTO");
              downloads.push({ type: label, url: dlUrl, isMirror });
            }
          }
        });

      if (downloads.length === 0) {
        doc2.querySelectorAll("a.btn").forEach((a) => {
          let href = a.getAttribute("href");
          if (
            href &&
            (href.includes("downloads.acxcdn.com") ||
              href.includes("twimg.com") ||
              href.includes("tweeload"))
          ) {
            const text = a.textContent.trim();
            if (
              text.toLowerCase() !== "download via the mobile app" &&
              !isPaywallOrInvalid(href, text)
            ) {
              const label = formatResolutionLabel(text, "", href);
              const isImg =
                /\.(jpe?g|png|webp)(\?|$)/i.test(href) ||
                label === "IMAGE" ||
                label === "PHOTO";
              const isMirror = isImg
                ? false
                : downloads.some(
                    (d) => d.type !== "IMAGE" && d.type !== "PHOTO",
                  );
              downloads.push({ type: label, url: href, isMirror });
            }
          }
        });
      }

      if (downloads.length === 0) throw new Error("Twitter links not found.");

      const name = doc2
        .querySelector(".download__item__info__user__name")
        ?.textContent?.trim();
      const handle = doc2
        .querySelector(".download__item__info__user__handle")
        ?.textContent?.trim();
      const thumbnail =
        doc2
          .querySelector(".download__item__preview img, .download__item img")
          ?.getAttribute("src") || null;

      _twSource = null;
      return createScraperResult(true, {
        title: name ? `${name} (${handle})` : "Twitter Content",
        thumbnail,
        downloads,
        sourceUrl: url,
      });
    }

    throw new Error("Invalid source selected.");
  } catch (err) {
    _twSource = null;
    return createScraperResult(false, err.message, currentStatus);
  }
}
