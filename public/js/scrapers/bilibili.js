import { CHROME_UA } from "../utils/index.js";
import { getCleanUrl } from "../utils/urlUtils.js";
import { scraperFetch, createScraperResult } from "./httpHelper.js";

async function sha256(message) {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function scrapeBilibili(url) {
  try {
    let cleanUrl = getCleanUrl(url);

    // Resolve redirection if it's a short URL (b23.tv or bili.im)
    if (cleanUrl.includes("b23.tv") || cleanUrl.includes("bili.im")) {
      try {
        const redirectRes = await scraperFetch(
          {
            url: cleanUrl,
            rawResponse: true,
          },
          "Bilibili Redirect",
        );
        if (redirectRes.url && redirectRes.url !== cleanUrl) {
          cleanUrl = redirectRes.url;
        } else if (redirectRes.data && typeof redirectRes.data === "string") {
          const hrefMatch = redirectRes.data.match(/href="([^"]+)"/i);
          if (hrefMatch) {
            cleanUrl = hrefMatch[1].replace(/&amp;/g, "&");
          }
        }
      } catch (e) {
        console.error("Bilibili redirect resolve failed:", e);
      }
    }

    if (cleanUrl.includes("bilibili.tv")) {
      try {
        const u = new URL(cleanUrl);
        cleanUrl = u.origin + u.pathname;
      } catch (e) {}

      try {
        const urlObj = new URL(cleanUrl);
        const parts = urlObj.pathname.split("/").filter(Boolean);

        let apiInfo = null;
        let title = "Bilibili.tv Video";
        let thumbnail = null;

        const idxVideo = parts.indexOf("video");
        if (idxVideo !== -1) {
          const aid = parts[idxVideo + 1];
          if (aid && /^\d+$/.test(aid)) {
            apiInfo = { tipo: "video", id: aid };
          }
        }

        const idxPlay = parts.indexOf("play");
        if (idxPlay !== -1) {
          const numericParts = parts
            .slice(idxPlay + 1)
            .filter((p) => /^\d+$/.test(p));
          if (numericParts.length > 1) {
            apiInfo = { tipo: "anime", id: numericParts[1] };
          } else if (numericParts.length === 1) {
            apiInfo = { tipo: "anime", id: null, seasonId: numericParts[0] };
          }
        }

        if (!apiInfo) {
          throw new Error("Could not parse Bilibili.tv video or episode ID.");
        }

        let html = "";
        try {
          html = await scraperFetch(
            {
              url: cleanUrl,
              parseJson: false,
            },
            "Bilibili Metadata",
          );
          html = typeof html === "string" ? html : "";
          const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
          if (titleMatch) title = titleMatch[1].trim();

          const imageMatch =
            html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i) ||
            html.match(/<meta\s+name="twitter:image"\s+content="([^"]+)"/i);
          if (imageMatch) thumbnail = imageMatch[1];
        } catch (err) {
          console.error("Failed to fetch Bilibili.tv page metadata:", err);
        }

        if (apiInfo.tipo === "anime" && !apiInfo.id && apiInfo.seasonId) {
          try {
            const epData = await scraperFetch(
              {
                url: `https://api.bilibili.tv/intl/gateway/web/v2/ogv/play/episodes?season_id=${apiInfo.seasonId}&platform=web&s_locale=en_US`,
              },
              "Bilibili Episodes",
            );
            if (epData && epData.data && epData.data.sections) {
              for (const sec of epData.data.sections) {
                if (sec.episodes && sec.episodes.length > 0) {
                  apiInfo.id = sec.episodes[0].ep_id;
                  break;
                }
              }
            }
          } catch (e) {
            console.error("Failed to resolve season episodes:", e);
          }
          if (!apiInfo.id && html) {
            const epMatch = html.match(/"ep_id"\s*:\s*(\d+)/);
            if (epMatch) apiInfo.id = epMatch[1];
          }
        }

        const downloads = [];

        if (apiInfo.tipo === "anime" && apiInfo.id) {
          try {
            const v2Data = await scraperFetch(
              {
                url: `https://api.bilibili.tv/intl/gateway/v2/ogv/playurl?ep_id=${apiInfo.id}&platform=web&s_locale=en_US`,
              },
              "Bilibili OGV v2",
            );
            if (v2Data && v2Data.data && v2Data.data.video_info) {
              const streamList = v2Data.data.video_info.stream_list || [];
              streamList.forEach((s) => {
                const playUrl = s.url || s.url_list?.[0]?.url;
                if (playUrl) {
                  let secureUrl = playUrl;
                  if (secureUrl.startsWith("http://")) {
                    secureUrl = secureUrl.replace("http://", "https://");
                  }
                  downloads.push({
                    url: secureUrl,
                    type: "VIDEO",
                    quality: s.desc_words || `${s.quality}p`,
                    headers: {
                      Referer: "https://www.bilibili.tv/",
                    },
                  });
                }
              });

              const dash = v2Data.data.video_info.dash;
              if (dash) {
                if (dash.video && downloads.length === 0) {
                  dash.video.forEach((v) => {
                    let vUrl = v.base_url || v.backup_url?.[0];
                    if (vUrl) {
                      if (vUrl.startsWith("http://")) {
                        vUrl = vUrl.replace("http://", "https://");
                      }
                      downloads.push({
                        url: vUrl,
                        type: "VIDEO",
                        quality: `${v.id || 360}p`,
                        headers: {
                          Referer: "https://www.bilibili.tv/",
                        },
                      });
                    }
                  });
                }
                if (dash.audio) {
                  dash.audio.forEach((a) => {
                    let aUrl = a.base_url || a.backup_url?.[0];
                    if (aUrl) {
                      if (aUrl.startsWith("http://")) {
                        aUrl = aUrl.replace("http://", "https://");
                      }
                      downloads.push({
                        url: aUrl,
                        type: "AUDIO",
                        quality: "MP3",
                        headers: {
                          Referer: "https://www.bilibili.tv/",
                        },
                      });
                    }
                  });
                }
              }
            }
          } catch (e) {
            console.error("OGV v2 API failed:", e);
          }
        }

        if (downloads.length === 0 && apiInfo.id) {
          try {
            const playData = await scraperFetch(
              {
                url: `https://api.bilibili.tv/intl/gateway/web/v2/playurl?aid=${apiInfo.id}&platform=web&s_locale=en_US`,
              },
              "Bilibili PlayURL",
            );
            if (playData && playData.data && playData.data.playurl) {
              const videoList =
                playData.data.playurl.video || playData.data.playurl.durl || [];
              videoList.forEach((v) => {
                let vUrl = v.url || v.base_url;
                if (vUrl) {
                  if (vUrl.startsWith("http://")) {
                    vUrl = vUrl.replace("http://", "https://");
                  }
                  downloads.push({
                    url: vUrl,
                    type: "VIDEO",
                    quality: v.quality ? `${v.quality}p` : "HD",
                    headers: {
                      Referer: "https://www.bilibili.tv/",
                    },
                  });
                }
              });
            }
          } catch (e) {
            console.error("Fallback v2 PlayURL failed:", e);
          }
        }

        if (downloads.length > 0) {
          return createScraperResult(true, {
            title,
            thumbnail,
            downloads,
            sourceUrl: url,
          });
        }
      } catch (e) {
        console.error("Bilibili.tv parse error:", e);
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
      "Bilibili Seekin",
    );

    if (!responseData || responseData.code !== "0000" || !responseData.data) {
      throw new Error(responseData?.msg || "Failed to process Bilibili URL.");
    }

    const info = responseData.data;
    const title = info.title || "Bilibili Video";
    const thumbnail = info.imageUrl || null;
    const downloads = [];

    if (info.medias && info.medias.length > 0) {
      for (let i = 0; i < info.medias.length; i++) {
        const item = info.medias[i];
        downloads.push({
          url: item.url,
          type: "VIDEO",
          quality: item.format || `Part ${i + 1}`,
        });
      }
    }

    if (downloads.length === 0) throw new Error("No video URLs found.");

    return createScraperResult(true, {
      title,
      thumbnail,
      author: "Bilibili Creator",
      downloads,
      sourceUrl: url,
    });
  } catch (e) {
    return createScraperResult(false, e.message);
  }
}
