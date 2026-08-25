import { getCleanUrl } from "../utils/urlUtils.js";
import { scraperFetch, createScraperResult } from "./httpHelper.js";

export async function scrapeRedNote(url) {
  try {
    let cleanUrl = getCleanUrl(url);

    // Resolve redirection if it's a short URL (xhslink.com or xhslink.cn)
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
              /href="(https?:\/\/(?:www\.)?(?:xiaohongshu\.com|rednote\.com)\/(?:explore|discovery\/item|red_video)\/[^"]+)"/,
            );
          if (canonicalMatch) {
            cleanUrl = canonicalMatch[1];
          }
        }
      } catch (e) {
        console.error("RedNote redirect resolve failed:", e);
      }
    }

    // Helper function to parse state JSON and extract media
    const extractMediaFromHtml = (htmlContent) => {
      const htmlStr = typeof htmlContent === "string" ? htmlContent : "";
      const matchState =
        htmlStr.match(
          /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]+?\});?<\/script>/,
        ) ||
        htmlStr.match(
          /window\.__INITIAL_DATA__\s*=\s*(\{[\s\S]+?\});?<\/script>/,
        ) ||
        htmlStr.match(
          /__INITIAL_STATE__\s*=\s*(\{[\s\S]+?\});?<\/script>/,
        );

      if (!matchState) return null;

      try {
        const rawJson = matchState[1]
          .replace(/;\s*$/, "")
          .replace(/:\s*undefined/g, ":null");
        const state = JSON.parse(rawJson);
        const noteMap = state.note?.noteDetailMap;

        if (noteMap) {
          const keys = Object.keys(noteMap);
          for (const key of keys) {
            const item = noteMap[key];
            if (
              item &&
              item.note &&
              !Array.isArray(item.note) &&
              (item.note.title ||
                item.note.desc ||
                item.note.imageList ||
                item.note.video)
            ) {
              const noteData = item.note;
              const title =
                noteData.title || noteData.desc || "RedNote Post";
              const author =
                noteData.user?.nickname ||
                noteData.user?.nickName ||
                "RedNote Creator";
              let thumbnail = null;
              const downloads = [];

              if (noteData.imageList && noteData.imageList.length > 0) {
                thumbnail =
                  noteData.imageList[0].urlDefault ||
                  noteData.imageList[0].urlOriginal ||
                  noteData.imageList[0].url;
              }

              // Video post
              if (noteData.video && noteData.video.media) {
                const streamObj = noteData.video.media.stream || {};
                let videoUrl = null;
                const codecs = ["h264", "h265", "h266", "av1"];

                for (const c of codecs) {
                  if (Array.isArray(streamObj[c]) && streamObj[c].length > 0) {
                    const firstStream = streamObj[c][0];
                    videoUrl =
                      firstStream.masterUrl ||
                      firstStream.backupUrls?.[0] ||
                      firstStream.url;
                    if (videoUrl) break;
                  }
                }

                if (!videoUrl && noteData.video.media.video) {
                  videoUrl = noteData.video.media.video.masterUrl;
                }

                if (videoUrl) {
                  let secureUrl = videoUrl;
                  if (secureUrl.startsWith("http://")) {
                    secureUrl = secureUrl.replace("http://", "https://");
                  }
                  downloads.push({
                    url: secureUrl,
                    type: "VIDEO",
                    quality: "HD",
                  });
                }
              }

              // Image / Photo post
              if (noteData.imageList && noteData.imageList.length > 0) {
                noteData.imageList.forEach((img, idx) => {
                  let imgUrl = img.urlOriginal || img.urlDefault || img.url;
                  if (imgUrl) {
                    if (imgUrl.startsWith("http://")) {
                      imgUrl = imgUrl.replace("http://", "https://");
                    }
                    downloads.push({
                      url: imgUrl,
                      type: "IMAGE",
                      quality:
                        noteData.imageList.length > 1
                          ? `Photo ${idx + 1}`
                          : "HD",
                    });
                  }
                });
              }

              if (downloads.length > 0) {
                return {
                  title,
                  author,
                  thumbnail,
                  downloads,
                  sourceUrl: url,
                };
              }
            }
          }
        }
      } catch (err) {
        console.error("RedNote state JSON parse error:", err);
      }
      return null;
    };

    // Direct fetch with desktop User-Agent and auth cookies
    const urlsToTry = [cleanUrl];
    const idMatch = cleanUrl.match(
      /\/(?:explore|discovery\/item|red_video)\/([a-f0-9]{24})/i,
    );
    if (idMatch && !cleanUrl.includes("rednote.com")) {
      urlsToTry.push(`https://www.rednote.com/explore/${idMatch[1]}`);
    }

    for (const targetUrl of urlsToTry) {
      try {
        const html = await scraperFetch(
          {
            url: targetUrl,
            parseJson: false,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
              Cookie:
                "a1=18a1234567890abcdef1234567890abc; webId=1234567890abcdef",
              "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            },
          },
          "RedNote Direct HTML",
        );

        const extracted = extractMediaFromHtml(html);
        if (extracted) {
          return createScraperResult(true, extracted);
        }
      } catch (directErr) {
        console.error("RedNote direct HTML fetch failed for", targetUrl, directErr);
      }
    }

    throw new Error("Failed to extract media from RedNote URL.");
  } catch (e) {
    return createScraperResult(false, e.message);
  }
}
