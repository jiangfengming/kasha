module.exports = function(doc, metaOnly) {
  return {
    site: doc.site,
    path: doc.path,
    profile: doc.profile,
    status: doc.status,
    redirect: doc.redirect,
    meta: doc.meta,
    openGraph: doc.openGraph,
    links: doc.links,
    html: metaOnly ? undefined : doc.html,
    staticHTML: metaOnly ? undefined : doc.staticHTML,
    privateExpires: doc.privateExpires,
    sharedExpires: doc.sharedExpires,
    updatedAt: doc.updatedAt
  }
}
