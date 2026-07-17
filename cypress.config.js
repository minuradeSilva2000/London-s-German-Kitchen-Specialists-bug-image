const { defineConfig } = require("cypress");
const sharp = require("sharp");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

async function analyzeImageStyle(imageUrl) {
  try {
    if (
      !imageUrl ||
      imageUrl.endsWith(".svg") ||
      imageUrl.includes("logo") ||
      imageUrl.includes("gravatar") ||
      imageUrl.includes("data:")
    ) {
      return null;
    }

    const response = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 10000,
    });

    const imageInfo = await sharp(response.data).metadata();
    if (imageInfo.width < 100 || imageInfo.height < 100) {
      return null;
    }

    const image = await sharp(response.data)
      .resize(200, 200, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = image.data;
    const total = image.info.width * image.info.height;

    let grayPixels = 0;
    let coloredPixels = 0;
    let nearBlack = 0;
    let nearWhite = 0;
    let rDom = 0;
    let gDom = 0;
    let bDom = 0;

    for (let i = 0; i < pixels.length; i += 3) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];

      if (Math.abs(r - g) < 10 && Math.abs(g - b) < 10) {
        grayPixels++;
      } else {
        coloredPixels++;
      }

      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      if (maxC - minC > 15) {
        if (r === maxC) rDom++;
        else if (g === maxC) gDom++;
        else bDom++;
      }

      const lum = (r + g + b) / 3;
      if (lum < 30) nearBlack++;
      if (lum > 225) nearWhite++;
    }

    const grayPct = (grayPixels / total) * 100;
    const colorPct = (coloredPixels / total) * 100;
    const rDomPct = (rDom / total) * 100;
    const gDomPct = (gDom / total) * 100;
    const bDomPct = (bDom / total) * 100;
    const maxColorDom = Math.max(rDomPct, gDomPct, bDomPct);
    const nearBlackPct = (nearBlack / total) * 100;
    const nearWhitePct = (nearWhite / total) * 100;

    const isPureGrayscale = grayPct > 95 && maxColorDom < 1;
    const isMostlyGrayscale = grayPct > 85 && maxColorDom < 4;

    let style = null;

    if (isPureGrayscale) {
      if (nearWhitePct > 40 && nearBlackPct < 5) {
        style = "line-art-sketch";
      } else if (nearBlackPct > 5 || (nearWhitePct > 10 && nearBlackPct > 2)) {
        style = "grayscale-render";
      } else {
        style = "grayscale-render";
      }
    } else if (isMostlyGrayscale) {
      style = "grayscale-render";
    }

    if (!style) {
      return null;
    }

    return {
      isMatch: true,
      style: style,
      grayPercentage: Math.round(grayPct),
      colorRejection: Math.round(colorPct),
      maxColorDominance: Math.round(maxColorDom),
    };
  } catch {
    return null;
  }
}

async function fetchPageImageUrls(pageUrl) {
  const resp = await axios.get(pageUrl, {
    timeout: 15000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
    },
  });
  const html = resp.data;
  const imageUrls = new Set();

  const dataOrigSrcRegex = /data-orig-src=["']([^"']+)["']/g;
  let m;
  while ((m = dataOrigSrcRegex.exec(html)) !== null) {
    imageUrls.add(m[1]);
  }

  const imgSrcRegex = /<img[^>]*src=["']([^"']+)["']/g;
  while ((m = imgSrcRegex.exec(html)) !== null) {
    const url = m[1];
    if (
      url.startsWith("http") &&
      !url.endsWith(".svg") &&
      !url.includes("logo") &&
      !url.includes("gravatar") &&
      !url.includes("data:")
    ) {
      imageUrls.add(url);
    }
  }

  const dataBgRegex =
    /data-bg(?:-url)?=["']([^"']+\.(jpg|jpeg|png|webp)[^"']*)["']/gi;
  while ((m = dataBgRegex.exec(html)) !== null) {
    imageUrls.add(m[1]);
  }

  return [...imageUrls].filter(
    (u) =>
      u.startsWith("http") &&
      !u.endsWith(".svg") &&
      !u.includes("data:") &&
      !u.includes("logo") &&
      !u.includes("gravatar") &&
      (u.includes(".jpg") ||
        u.includes(".jpeg") ||
        u.includes(".png") ||
        u.includes(".webp"))
  );
}

module.exports = defineConfig({
  e2e: {
    baseUrl: "https://pgkltd.co.uk",
    defaultCommandTimeout: 15000,
    responseTimeout: 60000,
    pageLoadTimeout: 30000,

    setupNodeEvents(on, config) {
      on("task", {
        ensureReportDir() {
          const dir = path.join("cypress", "reports");
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          return null;
        },

        async fetchAllPortfolioLinks() {
          const pageResp = await axios.get(
            "https://pgkltd.co.uk/kitchens/",
            {
              timeout: 15000,
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
              },
            }
          );
          const html = pageResp.data;

          let nonce = null;
          const scripts = html.split(/<script[^>]*>/i);
          for (const script of scripts) {
            if (script.includes("pgkf_filter")) {
              const match = script.match(
                /var\s+NONCE\s*=\s*["']([a-f0-9]+)["']/
              );
              if (match) {
                nonce = match[1];
                break;
              }
            }
          }

          if (!nonce) {
            console.log("Nonce not found");
            return [];
          }

          console.log(`Found nonce: ${nonce}`);

          const body = new URLSearchParams();
          body.append("action", "pgkf_filter");
          body.append("nonce", nonce);
          body.append("offset", "0");
          body.append("limit", "200");

          const ajaxResp = await axios.post(
            "https://pgkltd.co.uk/wp-admin/admin-ajax.php",
            body.toString(),
            {
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
              },
              timeout: 30000,
            }
          );

          const data = ajaxResp.data;
          if (!data.success) {
            console.log("AJAX not successful");
            return [];
          }

          console.log(`Total projects: ${data.data.total}`);

          const initialLinks = [
            ...html.matchAll(
              /<a[^>]*class="pgkf-link"[^>]*href="([^"]+)"/g
            ),
          ].map((m) => m[1]);

          const ajaxLinks = [
            ...data.data.html.matchAll(
              /<a[^>]*class="pgkf-link"[^>]*href="([^"]+)"/g
            ),
          ].map((m) => m[1]);

          const allLinks = [
            ...new Set([...initialLinks, ...ajaxLinks]),
          ].filter((href) => href && href.includes("/portfolio/"));

          console.log(`Unique portfolio links: ${allLinks.length}`);
          return allLinks;
        },

        async scanAllPagesForGrayImages(portfolioLinks) {
          const grayImages = [];
          const CONCURRENCY = 10;

          for (let i = 0; i < portfolioLinks.length; i += CONCURRENCY) {
            const batch = portfolioLinks.slice(i, i + CONCURRENCY);
            const results = await Promise.all(
              batch.map(async (pageUrl) => {
                try {
                  const imageUrls = await fetchPageImageUrls(pageUrl);
                  const pageMatches = [];

                  for (const imgUrl of imageUrls) {
                    const result = await analyzeImageStyle(imgUrl);
                    if (result && result.isMatch) {
                      pageMatches.push({
                        url: imgUrl,
                        page: pageUrl,
                        style: result.style,
                        grayPercentage: result.grayPercentage,
                        colorRejection: result.colorRejection,
                        maxColorDominance: result.maxColorDominance,
                      });
                    }
                  }

                  const idx = i + batch.indexOf(pageUrl) + 1;
                  const slug = pageUrl.split("/portfolio/")[1] || pageUrl;
                  console.log(
                    `  [${idx}/${portfolioLinks.length}] ${slug}: ${imageUrls.length} images, ${pageMatches.length} matched`
                  );

                  return pageMatches;
                } catch (err) {
                  console.log(`  ERROR: ${pageUrl} - ${err.message}`);
                  return [];
                }
              })
            );

            results.forEach((pageMatches) => grayImages.push(...pageMatches));
          }

          return grayImages;
        },

        saveReport(data) {
          const dir = path.join("cypress", "reports");
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          const file = path.join(dir, "gray-image-report.json");
          const urls = [...new Set(data.images.map((i) => i.url))];

          const output = {
            totalImages: urls.length,
            pagesScanned: data.totalPagesScanned,
            collectedAt: data.collectedAt,
            urls: urls,
          };

          fs.writeFileSync(file, JSON.stringify(output, null, 2));

          console.log(`\n========================================`);
          console.log(`  GRAYSCALE IMAGE REPORT`);
          console.log(`========================================`);
          console.log(`  Total URLs : ${urls.length}`);
          console.log(`  Pages      : ${data.totalPagesScanned}`);
          console.log(`  Saved to   : ${file}`);
          console.log(`========================================\n`);

          urls.forEach((url, i) => {
            console.log(`  ${i + 1}. ${url}`);
          });

          return null;
        },
      });

      return config;
    },
  },
});
