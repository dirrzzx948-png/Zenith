import {
  CHROME_UA,
  getCookiesFromHeaders,
  serializeData,
} from "../utils/index.js";
import { scraperFetch, createScraperResult } from "./httpHelper.js";

export let _spSource = null;
export function setSpotifySource(source) {
  _spSource = source;
}

export async function scrapeSpotify(url) {
  if (!_spSource) {
    return { status: true, requireSource: true };
  }

  let currentStatus = null;
  try {
    if (_spSource === "spotmate") {
      const r1 = await scraperFetch(
        {
          url: "https://spotmate.online/en1",
          headers: { "User-Agent": CHROME_UA },
          rawResponse: true,
        },
        "SpotMate Main",
      );
      currentStatus = r1.status;
      const cookies = getCookiesFromHeaders(r1.headers);
      const parser = new DOMParser();
      const doc1 = parser.parseFromString(r1.data, "text/html");

      const csrfToken = doc1
        .querySelector('meta[name="csrf-token"]')
        ?.getAttribute("content");
      if (!csrfToken) {
        throw new Error("Could not extract CSRF token from SpotMate.");
      }

      const apiHeaders = {
        "X-CSRF-TOKEN": csrfToken,
        "Content-Type": "application/json",
        "User-Agent": CHROME_UA,
        Referer: "https://spotmate.online/en1",
        Origin: "https://spotmate.online",
        "X-Requested-With": "XMLHttpRequest",
      };
      if (cookies) apiHeaders["Cookie"] = cookies;

      const r2 = await scraperFetch(
        {
          url: "https://spotmate.online/getTrackData",
          method: "POST",
          data: JSON.stringify({ spotify_url: url }),
          headers: apiHeaders,
          rawResponse: true,
        },
        "SpotMate TrackData",
      );
      currentStatus = r2.status;
      const trackData =
        typeof r2.data === "string" ? JSON.parse(r2.data) : r2.data;
      if (!trackData || trackData.error || !trackData.name) {
        throw new Error(
          trackData?.message || "Failed to fetch track details from SpotMate.",
        );
      }

      const title = trackData.name;
      const artist = trackData.artists
        ? trackData.artists.map((a) => a.name).join(", ")
        : "Unknown Artist";
      const thumbnail =
        trackData.album && trackData.album.images && trackData.album.images[0]
          ? trackData.album.images[0].url
          : "";

      const r3 = await scraperFetch(
        {
          url: "https://spotmate.online/convert",
          method: "POST",
          data: JSON.stringify({ urls: url }),
          headers: apiHeaders,
          rawResponse: true,
        },
        "SpotMate Convert",
      );
      currentStatus = r3.status;
      const convertData =
        typeof r3.data === "string" ? JSON.parse(r3.data) : r3.data;
      if (!convertData || convertData.error || !convertData.url) {
        throw new Error(
          convertData?.message || "Failed to get download URL from SpotMate.",
        );
      }

      _spSource = null;
      return createScraperResult(true, {
        title: artist ? `${artist} - ${title}` : title,
        thumbnail,
        downloads: [
          {
            type: "MP3",
            url: convertData.url,
          },
        ],
        sourceUrl: url,
      });
    }

    // Default: SpotiDown
    const r1 = await scraperFetch(
      {
        url: "https://spotidown.app/",
        headers: { "User-Agent": CHROME_UA },
        rawResponse: true,
      },
      "SpotiDown Main",
    );
    currentStatus = r1.status;

    const parser = new DOMParser();
    const doc1 = parser.parseFromString(r1.data, "text/html");

    const form = doc1.querySelector('form[name="spotifyurl"]');
    const data = { url: url };
    form?.querySelectorAll("input").forEach((input) => {
      const name = input.getAttribute("name");
      const value = input.getAttribute("value") || "";
      if (name && name !== "url") data[name] = value;
    });

    const r2 = await scraperFetch(
      {
        url: "https://spotidown.app/action",
        method: "POST",
        data: serializeData(data),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": CHROME_UA,
          Origin: "https://spotidown.app",
          Referer: "https://spotidown.app/",
        },
        rawResponse: true,
      },
      "SpotiDown Action",
    );

    let r2Data = r2.data;
    if (typeof r2Data === "string") {
      try {
        r2Data = JSON.parse(r2Data);
      } catch (e) {}
    }

    if (r2Data.error) throw new Error(r2Data.message || "Spotify error");

    let finalHtml = r2Data.data;
    const doc2 = parser.parseFromString(finalHtml, "text/html");
    const form2 = doc2.querySelector('form[name="submitspurl"]');

    if (form2) {
      const data2 = {};
      form2.querySelectorAll("input").forEach((input) => {
        const name = input.getAttribute("name");
        const value = input.getAttribute("value") || "";
        if (name) data2[name] = value;
      });

      const r3 = await scraperFetch(
        {
          url: "https://spotidown.app/action/track",
          method: "POST",
          data: serializeData(data2),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": CHROME_UA,
            Origin: "https://spotidown.app",
            Referer: "https://spotidown.app/",
          },
          rawResponse: true,
        },
        "SpotiDown Track",
      );

      let r3Data = r3.data;
      if (typeof r3Data === "string") {
        try {
          r3Data = JSON.parse(r3Data);
        } catch (e) {}
      }
      finalHtml = r3Data.data || r3Data;
    }

    const doc3 = parser.parseFromString(finalHtml, "text/html");
    const title =
      doc3.querySelector("h3")?.textContent?.trim() || "Spotify Track";
    const artist = doc3.querySelector("p")?.textContent?.trim();
    const thumbnail = doc3.querySelector("img")?.getAttribute("src");
    const downloads = [];

    doc3.querySelectorAll("a").forEach((a) => {
      const link = a.getAttribute("href");
      const text = a.textContent.trim();
      if (
        link &&
        link.startsWith("http") &&
        !link.includes("premium.html") &&
        text !== "Download Another Song"
      ) {
        downloads.push({ type: text || "MP3", url: link });
      }
    });

    _spSource = null;
    return createScraperResult(true, {
      title: artist ? `${artist} - ${title}` : title,
      thumbnail,
      downloads,
      sourceUrl: url,
    });
  } catch (err) {
    _spSource = null;
    return createScraperResult(false, err.message, currentStatus);
  }
}
