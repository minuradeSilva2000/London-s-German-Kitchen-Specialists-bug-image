describe("PGK Kitchen Architectural Style Image Collector", () => {
  before(() => {
    cy.task("ensureReportDir");
  });

  it("Collect line art and grayscale render images from all kitchen portfolio pages", () => {
    cy.task("fetchAllPortfolioLinks").then((portfolioLinks) => {
      expect(portfolioLinks).to.have.length.greaterThan(0);
      cy.log(`Scanning ${portfolioLinks.length} portfolio pages`);

      cy.task("scanAllPagesForGrayImages", portfolioLinks, {
        timeout: 1800000,
      }).then((matchedImages) => {
        const uniqueUrls = [
          ...new Set(matchedImages.map((img) => img.url)),
        ];

        cy.task("saveReport", {
          totalMatchedImages: matchedImages.length,
          uniqueImageUrls: uniqueUrls.length,
          totalPagesScanned: portfolioLinks.length,
          collectedAt: new Date().toISOString(),
          images: matchedImages,
        });
      });
    });
  });
});
