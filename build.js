/**
 * build.js — Build-Time Injection for Static HTML Sites
 *
 * Processes all src/*.html files:
 *   - Replaces INCLUDE markers with content from _includes/
 *   - Injects JSON-LD schema (global + per-page)
 *   - Generates sitemap.xml, robots.txt, and ai.txt
 *   - Copies Assets/ to dist/
 *
 * Outputs to dist/ for Cloudflare Pages deployment.
 */

const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

const INCLUDES_DIR = '_includes';
const SRC_DIR = 'src';
const DIST_DIR = 'dist';
const SCHEMA_DIR = path.join(INCLUDES_DIR, 'schema');

// ── Helpers ─────────────────────────────────────────────────────────────────

function readInclude(name) {
    const filePath = path.join(INCLUDES_DIR, name);
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8').trim();
}

function readJsonInclude(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        const content = fs.readFileSync(filePath, 'utf8').trim();
        JSON.parse(content);
        return content;
    } catch (e) {
        console.warn("Warning: Invalid JSON in " + filePath + ": " + e.message);
        return null;
    }
}

// ── Deep merge utility for Tailwind configs ─────────────────────────────────
// Merges multiple config objects so that colors/fonts from ALL pages are included.

function deepMerge(target, source) {
    if (!source) return target;
    if (!target) return source;
    var result = Object.assign({}, target);
    var keys = Object.keys(source);
    for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        if (
            result[key] && typeof result[key] === "object" && !Array.isArray(result[key]) &&
            source[key] && typeof source[key] === "object" && !Array.isArray(source[key])
        ) {
            result[key] = deepMerge(result[key], source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

// ── Nested path resolver (multi-level) ───────────────────────────────────
// Walk up the parent chain to build the full nested path.
// e.g., "chimney-sweeping" with parent "services" → "services/chimney-sweeping"
// e.g., "inspection" with parent "chimney" with parent "services" → "services/chimney/inspection"

function resolveNestedPath(slug, parents) {
    var parts = [];
    var current = slug;
    var seen = {};
    while (parents[current] && !seen[current]) {
        seen[current] = true;
        parts.unshift(parents[current]);
        current = parents[current];
    }
    return parts.length > 0 ? parts.join("/") + "/" + slug : slug;
}

// ── Setup dist ──────────────────────────────────────────────────────────────

if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
}
fs.mkdirSync(DIST_DIR, { recursive: true });

// ── Read site-wide includes ─────────────────────────────────────────────────

var header = readInclude('header.html');
var footer = readInclude('footer.html');
const headScripts = readInclude('head_scripts.html');
const bodyScripts = readInclude('body_scripts.html');
const faviconHtml = readInclude('favicon.html');
const globalSchemaJson = readJsonInclude(path.join(SCHEMA_DIR, 'global.json'));

// ── Read template variable data ─────────────────────────────────────────────

var siteDataStr = readJsonInclude(path.join(INCLUDES_DIR, 'site-data.json'));
var siteData = siteDataStr ? JSON.parse(siteDataStr) : {};
var PAGE_DATA_DIR = path.join(INCLUDES_DIR, 'page-data');
console.log("   Site data: " + (siteDataStr ? Object.keys(siteData).length + " var(s)" : "none"));

// ── Read page robots config ─────────────────────────────────────────────────

var pageRobotsStr = readJsonInclude(path.join(INCLUDES_DIR, 'page-robots.json'));
var pageRobots = pageRobotsStr ? JSON.parse(pageRobotsStr) : {};
console.log("   Page robots: " + (pageRobotsStr ? Object.keys(pageRobots).length + " page(s) with overrides" : "none"));

// ── Read page parent mapping (nested URL slugs) ─────────────────────────────

var pageParentsStr = readJsonInclude(path.join(INCLUDES_DIR, 'page-parents.json'));
var pageParents = pageParentsStr ? JSON.parse(pageParentsStr) : {};
console.log("   Page parents: " + (pageParentsStr ? Object.keys(pageParents).length + " child page(s)" : "none"));

// ── Read nav data ───────────────────────────────────────────────────────────

var navJsonStr = readJsonInclude(path.join(INCLUDES_DIR, 'nav.json'));
var navTemplatesStr = readJsonInclude(path.join(INCLUDES_DIR, 'nav_templates.json'));

console.log('Build-Time Injection starting...');
console.log("   Header: " + (header ? header.length + " chars" : "not found"));
console.log("   Footer: " + (footer ? footer.length + " chars" : "not found"));
console.log("   Head scripts: " + (headScripts ? headScripts.length + " chars" : "none"));
console.log("   Body scripts: " + (bodyScripts ? bodyScripts.length + " chars" : "none"));
console.log("   Global schema: " + (globalSchemaJson ? "yes" : "none"));
console.log("   Nav data: " + (navJsonStr ? "yes" : "none"));

// ── Inject nav items into header ────────────────────────────────────────────

if (navJsonStr && navTemplatesStr && header) {
    try {
        var navItems = JSON.parse(navJsonStr);
        var templates = JSON.parse(navTemplatesStr);

        // Build desktop nav HTML
        var desktopHtml = navItems.map(function(item) {
            if (item.children && item.children.length > 0 && templates.nav_dropdown) {
                var childHtml = item.children.map(function(c) {
                    return (templates.nav_dropdown_item || "")
                        .replace(/\{\{href\}\}/g, c.href)
                        .replace(/\{\{label\}\}/g, c.label);
                }).join("\n                        ");
                var slug = item.label.toLowerCase().replace(/\s+/g, "-");
                return templates.nav_dropdown
                    .replace(/\{\{href\}\}/g, item.href)
                    .replace(/\{\{label\}\}/g, item.label)
                    .replace(/\{\{slug\}\}/g, slug)
                    .replace("<!-- DROPDOWN_ITEMS -->", childHtml);
            }
            return (templates.nav_item || "")
                .replace(/\{\{href\}\}/g, item.href)
                .replace(/\{\{label\}\}/g, item.label);
        }).join("\n                ");

        // Build mobile nav HTML
        var mobileHtml = navItems.map(function(item) {
            if (item.children && item.children.length > 0 && templates.mobile_nav_dropdown) {
                var childHtml = item.children.map(function(c) {
                    return (templates.mobile_nav_dropdown_item || "")
                        .replace(/\{\{href\}\}/g, c.href)
                        .replace(/\{\{label\}\}/g, c.label);
                }).join("\n                        ");
                return templates.mobile_nav_dropdown
                    .replace(/\{\{href\}\}/g, item.href)
                    .replace(/\{\{label\}\}/g, item.label)
                    .replace("<!-- MOBILE_DROPDOWN_ITEMS -->", childHtml);
            }
            return (templates.mobile_nav_item || "")
                .replace(/\{\{href\}\}/g, item.href)
                .replace(/\{\{label\}\}/g, item.label);
        }).join("\n                ");

        header = header.replace("<!-- NAV_ITEMS_DESKTOP -->", desktopHtml);
        header = header.replace("<!-- NAV_ITEMS_MOBILE -->", mobileHtml);

        // Build footer nav HTML
        if (templates.footer_nav_item) {
            var footerNavHtml = navItems.map(function(item) {
                return templates.footer_nav_item
                    .replace(/\{\{href\}\}/g, item.href)
                    .replace(/\{\{label\}\}/g, item.label);
            }).join("\n                        ");
            footer = footer.replace("<!-- NAV_ITEMS_FOOTER -->", footerNavHtml);
        }

        console.log("   Nav: injected " + navItems.length + " item(s) into header + footer");
    } catch (navErr) {
        console.warn("   Nav injection warning: " + navErr.message);
    }
}

// ── Conditional nav interaction JS (only when dropdowns exist) ────────────
// Only strip pattern-specific JS and inject universal handlers if the site
// has dropdown nav templates. Otherwise, leave the original header JS alone.
if (templates && templates.nav_dropdown) {
    // Strip pattern-specific toggle functions that reference hardcoded IDs
    header = header.replace(/<script>[\s\S]*?toggleDropdown[\s\S]*?<\/script>/gi, "");
    header = header.replace(/<script>[\s\S]*?toggleMobileMenu[\s\S]*?<\/script>/gi, "");

    // Inject universal nav interaction script
    var navInteractionScript = [
        "<script>",
        "(function(){",
        "  var mobileBtn=document.getElementById('mobile-menu-trigger');",
        "  var mobileMenu=document.getElementById('mobile-menu');",
        "  var hamburgerIcon=document.getElementById('hamburger-icon');",
        "  if(mobileBtn&&mobileMenu){",
        "    mobileBtn.addEventListener('click',function(){",
        "      var v=mobileMenu.classList.contains('opacity-100');",
        "      if(v){mobileMenu.classList.remove('opacity-100','visible');mobileMenu.classList.add('opacity-0','invisible');if(hamburgerIcon)hamburgerIcon.innerHTML='<path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M4 6h16M4 12h16M4 18h16\"></path>';}",
        "      else{mobileMenu.classList.remove('opacity-0','invisible');mobileMenu.classList.add('opacity-100','visible');if(hamburgerIcon)hamburgerIcon.innerHTML='<path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M6 18L18 6M6 6l12 12\"></path>';}",
        "    });",
        "  }",
        "  // Initialize: ensure all dropdown panels start hidden",
        "  var initTriggers=document.querySelectorAll('[id$=\\\"-trigger\\\"]');",
        "  initTriggers.forEach(function(trigger){",
        "    if(trigger.id==='mobile-menu-trigger')return;",
        "    var pid=trigger.id.replace('-trigger','');",
        "    var panel=document.getElementById(pid);",
        "    if(panel){panel.classList.add('opacity-0','invisible');panel.classList.remove('opacity-100','visible');}",
        "  });",
        "  document.addEventListener('click',function(e){",
        "    var triggers=document.querySelectorAll('[id$=\"-trigger\"]');",
        "    var clicked=null;",
        "    triggers.forEach(function(t){if(t.contains(e.target))clicked=t;});",
        "    triggers.forEach(function(trigger){",
        "      if(trigger.id==='mobile-menu-trigger')return;",
        "      var pid=trigger.id.replace('-trigger','');",
        "      var panel=document.getElementById(pid);",
        "      var chev=trigger.querySelector('svg');",
        "      if(!panel)return;",
        "      if(trigger===clicked){",
        "        var open=panel.classList.contains('opacity-100');",
        "        if(open){panel.classList.remove('opacity-100','visible');panel.classList.add('opacity-0','invisible');if(chev)chev.classList.remove('rotate-180');}",
        "        else{panel.classList.remove('opacity-0','invisible');panel.classList.add('opacity-100','visible');if(chev)chev.classList.add('rotate-180');}",
        "      }else if(!panel.contains(e.target)){",
        "        panel.classList.remove('opacity-100','visible');panel.classList.add('opacity-0','invisible');if(chev)chev.classList.remove('rotate-180');",
        "      }",
        "    });",
        "  });",
        "})();",
        "</script>"
    ].join("\n");

    if (header.indexOf("</header>") !== -1) {
        header = header.replace("</header>", "</header>\n" + navInteractionScript);
    } else {
        header = header + "\n" + navInteractionScript;
    }
    console.log("   Nav interactions: injected universal dropdown/mobile JS");
} else {
    console.log("   Nav interactions: no dropdown templates found — keeping original header JS");
}

// ── Read build-config.json (domain for canonical/sitemap) ────────────────────

var configPath = 'build-config.json';
var sitemapDomain = '';
var cfPagesProject = '';
if (fs.existsSync(configPath)) {
    try {
        var config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        sitemapDomain = (config.domain || '').replace(/\/+$/, '');
        cfPagesProject = config.cfPagesProject || '';
    } catch (e) {
        console.warn("Warning: Could not read build-config.json: " + e.message);
    }
}

// ── Branch-aware domain resolution ──────────────────────────────────────────
// Cloudflare Pages sets CF_PAGES_BRANCH at build time.
// If building on a non-production branch (e.g., "staging"),
// override sitemapDomain to use the branch preview URL.
var cfBranch = process.env.CF_PAGES_BRANCH || '';
if (cfBranch && cfBranch !== 'main' && cfBranch !== 'production' && cfPagesProject) {
    sitemapDomain = 'https://' + cfBranch + '.' + cfPagesProject + '.pages.dev';
    console.log("   Branch: " + cfBranch + " (non-production) → domain overridden to " + sitemapDomain);
}

console.log("   Domain: " + (sitemapDomain || "(not set)"));

// ── Process HTML files ──────────────────────────────────────────────────────

if (!fs.existsSync(SRC_DIR)) {
    console.error("ERROR: Source directory " + SRC_DIR + " not found!");
    process.exit(1);
}

const htmlFiles = fs.readdirSync(SRC_DIR).filter(function(f) { return f.endsWith('.html'); });
console.log("   Found " + htmlFiles.length + " HTML file(s) in src/");

var processedPages = [];

// ── Build slug → correctPath map for universal link rewriting ──
var slugToCorrectPath = {};
for (var mi = 0; mi < htmlFiles.length; mi++) {
    var mapSlug = htmlFiles[mi].replace('.html', '');
    if (mapSlug === 'index' || mapSlug === '404') continue;
    slugToCorrectPath[mapSlug] = resolveNestedPath(mapSlug, pageParents);
}
var allKnownSlugs = Object.keys(slugToCorrectPath);
console.log('   Slug map: ' + allKnownSlugs.length + ' page(s) for link rewriting');

for (var i = 0; i < htmlFiles.length; i++) {
    var file = htmlFiles[i];
    var inputPath = path.join(SRC_DIR, file);
    var slug = file.replace('.html', '');
    var nestedSlug = resolveNestedPath(slug, pageParents);
    var outputPath = path.join(DIST_DIR, nestedSlug + '.html');
    var outputDir = path.dirname(outputPath);
    if (outputDir !== DIST_DIR) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    var html = fs.readFileSync(inputPath, 'utf8');

    // Replace INCLUDE markers (site-level)
    html = html.replace('<!-- INCLUDE:header -->', header);
    html = html.replace('<!-- INCLUDE:footer -->', footer);

    // Head scripts: site-level + per-page
    var pageHeadScripts = readInclude(path.join('pages', slug, 'head_scripts.html'));
    var combinedHeadScripts = [headScripts, pageHeadScripts].filter(Boolean).join("\n");
    html = html.replace('<!-- INCLUDE:head_scripts -->', combinedHeadScripts);

    // Body scripts: site-level + per-page
    var pageBodyScripts = readInclude(path.join('pages', slug, 'body_scripts.html'));
    var combinedBodyScripts = [bodyScripts, pageBodyScripts].filter(Boolean).join("\n");
    html = html.replace('<!-- INCLUDE:body_scripts -->', combinedBodyScripts);

    html = html.replace('<!-- INCLUDE:favicon -->', faviconHtml);

    // Build schema injection
    var schemas = [];
    if (globalSchemaJson) {
        schemas.push('<script type="application/ld+json">' + globalSchemaJson + '</script>');
    }

    // Per-page schema
    var pageSchemaJson = readJsonInclude(path.join(SCHEMA_DIR, slug + '.json'));
    if (pageSchemaJson) {
        schemas.push('<script type="application/ld+json">' + pageSchemaJson + '</script>');
    }

    html = html.replace('<!-- INCLUDE:schema -->', schemas.join('\n    '));

    // ── Form marker resolution (<!-- FORM:slug -->) ──
    var formMarkerRegex = /<!-- FORM:([a-z0-9-]+) -->/gi;
    var formMatch;
    while ((formMatch = formMarkerRegex.exec(html)) !== null) {
        var formSlug = formMatch[1];
        var formPath = path.join(INCLUDES_DIR, 'forms', formSlug + '.html');
        var formContent = '';
        if (fs.existsSync(formPath)) {
            formContent = fs.readFileSync(formPath, 'utf8').trim();
            // Strip preview wrapper (max-w container used for standalone preview)
            formContent = formContent.replace(/<!--\s*=+\s*-->\s*\n?\s*<!--\s*PREVIEW WRAPPER[^-]*-->\s*\n?\s*<div\s+class="[^"]*max-w-[^"]*"[^>]*>\s*\n?\s*<!--\s*=+\s*-->/gi, "");
            formContent = formContent.replace(/<!--\s*=+\s*-->\s*\n?\s*<!--\s*END PREVIEW WRAPPER[^-]*-->\s*\n?\s*<\/div>\s*\n?\s*<!--\s*=+\s*(?:-->|\/?>)/gi, "");
            formContent = formContent.trim();
            console.log("   Form: injected " + formSlug + " (" + formContent.length + " chars)");
        } else {
            formContent = "<!-- Form \"" + formSlug + "\" not found -->";
            console.warn("   Form: \"" + formSlug + "\" not found at " + formPath);
        }
        html = html.replace(formMatch[0], formContent);
        formMarkerRegex.lastIndex = 0;
    }

    // ── Template variable replacement (Handlebars) ──
    if (Object.keys(siteData).length > 0 || fs.existsSync(PAGE_DATA_DIR)) {
        try {
            var pageDataStr = readJsonInclude(path.join(PAGE_DATA_DIR, slug + '.json'));
            var pageData = pageDataStr ? JSON.parse(pageDataStr) : {};
            var templateData = Object.assign({}, siteData, { page: pageData });
            // Register helperMissing: unrecognized {{expressions}} pass through unchanged
            Handlebars.registerHelper("helperMissing", function() {
                var options = arguments[arguments.length - 1];
                return new Handlebars.SafeString("{{" + options.name + "}}");
            });
            var template = Handlebars.compile(html, { noEscape: true, strict: false });
            html = template(templateData);
        } catch (hbsErr) {
            console.warn("   ⚠ Handlebars warning for " + file + ": " + hbsErr.message);
        }
    }

    // ── Base href for nested URL child pages ──
    // When a child page is physically nested at /parent/child.html,
    // relative paths like ./styles.css resolve to /parent/styles.css (broken).
    // <base href="/"> forces the browser to resolve all relative URLs from root.
    if (nestedSlug !== slug && !/<base\s/i.test(html)) {
        html = html.replace('<head>', '<head>\n    <base href="/">');
        console.log('   Base href: injected for nested page ' + file + ' → ' + nestedSlug);
    }

    // ── Base href for 404 page ──
    // Cloudflare Pages serves 404.html at ANY URL depth (e.g. /a, /a/b, /a/b/c).
    // Without <base href="/">, relative paths break at nested 404 URLs.
    if (slug === '404' && !/<base\s/i.test(html)) {
        html = html.replace('<head>', '<head>\n    <base href="/">');
        console.log('   Base href: injected for 404 page');
    }

    // ── Robots meta injection ──
    var robotsConfig = pageRobots[file] || {};
    var robotsDirectives = [];
    if (robotsConfig.noindex) robotsDirectives.push('noindex');
    if (robotsConfig.nofollow) robotsDirectives.push('nofollow');
    if (robotsDirectives.length > 0) {
        var robotsMeta = '<meta name="robots" content="' + robotsDirectives.join(', ') + '">';
        html = html.replace('</head>', '    ' + robotsMeta + '\n</head>');
        console.log('   Robots: ' + file + ' → ' + robotsDirectives.join(', '));
    }
    // ── Canonical URL injection ──
    // Build correct canonical using nested clean URLs
    if (sitemapDomain) {
        var canonicalUrl;
        if (slug === 'index' || slug === 'home') {
            canonicalUrl = sitemapDomain + '/';
        } else {
            canonicalUrl = sitemapDomain + '/' + nestedSlug;
        }

        var canonicalTag = '<link rel="canonical" href="' + canonicalUrl + '">';
        if (nestedSlug !== slug) {
            // Nested pages: ALWAYS force correct canonical (override manual input)
            html = html.replace(/<link[^>]*rel=["']canonical["'][^>]*>/i, "");
            html = html.replace(/<link[^>]*href=["'][^"'][^>]*rel=["']canonical["'][^>]*>/i, "");
            html = html.replace('</head>', '    ' + canonicalTag + '\n</head>');
            console.log('   Canonical: ' + file + ' → ' + canonicalUrl + ' (nested, forced)');
        } else {
            // Top-level pages: only inject if user hasn't set one manually
            if (!/rel=["']canonical["']/.test(html)) {
                html = html.replace('</head>', '    ' + canonicalTag + '\n</head>');
                console.log('   Canonical: ' + file + ' → ' + canonicalUrl + ' (auto)');
            } else {
                console.log('   Canonical: ' + file + ' → kept existing (manual)');
            }
        }
    }

    // ── Strip leaked editor scripts ──
    // Remove site-editor preview scripts that should never appear on live sites
    html = html.replace(/<script>[\s\S]*?site-editor-navigate[\s\S]*?<\/script>\s*/gi, "");
    html = html.replace(/<script>[\s\S]*?editor-toggle[\s\S]*?<\/script>\s*/gi, "");
    html = html.replace(/<style\s+id=["']site-editor-styles["'][^>]*>[\s\S]*?<\/style>\s*/gi, "");

    // ── Universal link rewriting ──
    // Rewrites ALL internal links to correct clean URLs based on current page-parents.
    // Handles: flat-to-nested, nested-to-flat, and parent-change scenarios.
    for (var li = 0; li < allKnownSlugs.length; li++) {
        var cs = allKnownSlugs[li];
        var correctPath = slugToCorrectPath[cs];

        // Step 1: Flat with .html extension to correct clean URL
        html = html.split("./" + cs + ".html").join("/" + correctPath);
        html = html.split("/" + cs + ".html").join("/" + correctPath);
        html = html.split('"' + cs + '.html"').join('"/' + correctPath + '"');

        // Step 2: Wrong nested path to correct path (catches moved pages)
        //    e.g. /old-parent/slug when page moved to /new-parent/slug or /slug
        //    Also handles anchor fragments: /old-parent/slug#section
        var wrongPathRegex = new RegExp(
            'href="(\\.?\\/(?:[a-z0-9-]+\\/)*' + cs + ')(#[^"]*)?"',
            'gi'
        );
        html = html.replace(wrongPathRegex, function(match, foundPath, anchor) {
            var normalized = foundPath.replace(/^\.?\//, '');
            if (normalized === correctPath) return match;
            var segments = normalized.split('/');
            if (segments[segments.length - 1] === cs) {
                return 'href="/' + correctPath + (anchor || '') + '"';
            }
            return match;
        });
    }

    // Clean up any remaining .html extensions for top-level pages
    // e.g., ./about.html to ./about
    html = html.replace(/\.\/((?!Assets\/)[a-z0-9][a-z0-9-]*)\.html/gi, function(m, slug) {
        return "./" + slug;
    });

    fs.writeFileSync(outputPath, html, 'utf8');
    processedPages.push(nestedSlug + '.html');
    console.log("   OK: " + file);
}

// ── Page Index for 404 search ───────────────────────────────────────────────
// Build a JSON index of all pages (title + slug + description) and inject
// into 404.html so the error page search works without a backend.

var distIndexPath = path.join(DIST_DIR, '404.html');
if (fs.existsSync(distIndexPath)) {
    var pageIndex = processedPages
        .filter(function(f) { return f !== '404.html'; })
        .map(function(f) {
            var pagePath = f.replace('.html', '');
            var fullPath = path.join(DIST_DIR, f);
            if (!fs.existsSync(fullPath)) return null;
            var pageHtml = fs.readFileSync(fullPath, 'utf8');
            var titleMatch = pageHtml.match(/<title>([^<]*)<\/title>/i);
            var descMatch = pageHtml.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
            return {
                title: titleMatch ? titleMatch[1].split('|')[0].trim() : pagePath,
                slug: pagePath,
                description: descMatch ? descMatch[1].substring(0, 120) : ''
            };
        }).filter(function(p) { return p !== null; });

    var indexScript = '<script>var SITE_PAGES=' + JSON.stringify(pageIndex) + ';<\/script>';
    var errorHtml = fs.readFileSync(distIndexPath, 'utf8');
    errorHtml = errorHtml.replace('<!-- INCLUDE:page_index -->', indexScript);
    fs.writeFileSync(distIndexPath, errorHtml, 'utf8');
    console.log("   Page index: injected " + pageIndex.length + " page(s) into 404.html");
} else {
    console.log("   Page index: no 404.html found — skipping");
}

// ── Tailwind CSS Compilation ────────────────────────────────────────────────
// Replace runtime CDN (~125KB compiler) with pre-compiled CSS (~5-15KB)
// Merges configs from ALL pages so every custom color/font is included.
// Wrapped in try/catch: if compilation fails, CDN stays as fallback

(function() {
    try {
        // ── Merge Tailwind configs from ALL HTML files ──
        // Each page may use different patterns with different custom colors.
        // Deep-merge all configs so the compiled CSS covers every token.
        var mergedCfg = null;
        var configCount = 0;
        var configRegex = /<script>\s*tailwind\.config\s*=\s*([\s\S]*?)<\/script>/;

        for (var c = 0; c < htmlFiles.length; c++) {
            var cPath = path.join(DIST_DIR, htmlFiles[c]);
            var cHtml = fs.readFileSync(cPath, 'utf8');
            var cMatch = cHtml.match(configRegex);
            if (!cMatch) continue;

            var rawStr = cMatch[1].replace(/^\s*=\s*/, "").replace(/;\s*$/, "").trim();
            try {
                var parsed = JSON.parse(rawStr);
                if (!mergedCfg) {
                    mergedCfg = parsed;
                } else {
                    mergedCfg = deepMerge(mergedCfg, parsed);
                }
                configCount++;
            } catch (parseErr) {
                console.warn("   Tailwind: could not parse config from " + htmlFiles[c] + ": " + parseErr.message);
            }
        }

        if (!mergedCfg) {
            console.log("   Tailwind: no CDN config found in any HTML file — skipping compilation");
            return;
        }

        console.log("   Tailwind: merged configs from " + configCount + " HTML file(s)");

        // Write tailwind.config.js with merged config + content scanning path
        var twCfgContent = "module.exports = Object.assign(" + JSON.stringify(mergedCfg, null, 2) + ", { content: [\"./dist/**/*.html\"] });\n";
        fs.writeFileSync('tailwind.config.js', twCfgContent, 'utf8');
        console.log("   Tailwind: wrote tailwind.config.js");

        // Log the colors for verification
        if (mergedCfg.theme && mergedCfg.theme.extend && mergedCfg.theme.extend.colors) {
            console.log("   Tailwind: merged colors: " + Object.keys(mergedCfg.theme.extend.colors).join(", "));
        }

        // Create input CSS
        fs.writeFileSync('_tw_input.css', '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n', 'utf8');

        // Compile with Tailwind CLI
        var execSync = require("child_process").execSync;
        execSync("npx tailwindcss -i _tw_input.css -o " + path.join(DIST_DIR, "styles.css") + " --minify", {
            stdio: "pipe",
            timeout: 60000
        });

        var cssSize = fs.statSync(path.join(DIST_DIR, "styles.css")).size;
        console.log("   Tailwind: compiled styles.css (" + (cssSize / 1024).toFixed(1) + " KB)");

        // Post-process: strip CDN + inject compiled CSS in all HTML files
        for (var t = 0; t < htmlFiles.length; t++) {
            var tPath = path.join(DIST_DIR, htmlFiles[t]);
            var tHtml = fs.readFileSync(tPath, 'utf8');

            // Strip Tailwind CDN script
            tHtml = tHtml.replace(/<script[^>]*src="[^"]*cdn\.tailwindcss\.com[^"]*"[^>]*><\/script>/gi, "");
            // Strip tailwind.config inline script
            tHtml = tHtml.replace(/<script>\s*tailwind\.config\s*=[\s\S]*?<\/script>/gi, "");

            // Add compiled CSS link before </head>
            tHtml = tHtml.replace("</head>", "    <link rel=\"stylesheet\" href=\"./styles.css\">\n</head>");

            // ── Google Fonts: consolidate + make non-render-blocking ──
            var fontLinks = tHtml.match(/<link[^>]*href="(https:\/\/fonts\.googleapis\.com\/css2[^"]*)"[^>]*>/gi) || [];
            if (fontLinks.length > 0) {
                var allFamilies = {};
                for (var fl = 0; fl < fontLinks.length; fl++) {
                    var hrefMatch = fontLinks[fl].match(/href="([^"]*)"/);
                    if (!hrefMatch) continue;
                    var fUrl = hrefMatch[1].replace(/&amp;/g, "&");
                    var familyMatches = fUrl.match(/family=([^&]*)/g) || [];
                    for (var fm = 0; fm < familyMatches.length; fm++) {
                        var fam = familyMatches[fm].replace("family=", "");
                        var parts = fam.split(":");
                        var name = parts[0];
                        var weights = parts[1] || "";
                        if (!allFamilies[name]) allFamilies[name] = {};
                        if (weights) {
                            var wParts = weights.replace("wght@", "").replace("ital,wght@", "").split(";");
                            for (var w = 0; w < wParts.length; w++) allFamilies[name][wParts[w]] = true;
                        }
                    }
                }
                var familyParams = [];
                var names = Object.keys(allFamilies);
                for (var fn = 0; fn < names.length; fn++) {
                    var wArr = Object.keys(allFamilies[names[fn]]).sort();
                    familyParams.push("family=" + names[fn] + (wArr.length > 0 ? ":wght@" + wArr.join(";") : ""));
                }
                var consolidatedUrl = "https://fonts.googleapis.com/css2?" + familyParams.join("&") + "&display=swap";
                tHtml = tHtml.replace(/<link[^>]*href="https:\/\/fonts\.googleapis\.com\/css2[^"]*"[^>]*>\s*/gi, "");
                tHtml = tHtml.replace(/<link[^>]*rel="preconnect"[^>]*fonts\.googleapis\.com[^>]*>\s*/gi, "");
                tHtml = tHtml.replace(/<link[^>]*rel="preconnect"[^>]*fonts\.gstatic\.com[^>]*>\s*/gi, "");
                var fontBlock = "\n    <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">"
                    + "\n    <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>"
                    + '\n    <link rel="stylesheet" href="' + consolidatedUrl + '" media="print" onload="this.media=\'all\'">'
                    + '\n    <noscript><link rel="stylesheet" href="' + consolidatedUrl + '"></noscript>';
                tHtml = tHtml.replace("<head>", "<head>" + fontBlock);
                console.log("   Fonts: consolidated " + fontLinks.length + " links into 1 async link (" + names.length + " families)");
            }

            fs.writeFileSync(tPath, tHtml, 'utf8');
        }

        // Cleanup temp files
        try { fs.unlinkSync('_tw_input.css'); } catch(e) {}
        try { fs.unlinkSync('tailwind.config.js'); } catch(e) {}

        console.log("   Tailwind: stripped CDN from " + htmlFiles.length + " file(s)");
    } catch (twErr) {
        console.warn("   Tailwind compilation skipped (CDN kept as fallback): " + twErr.message);
        try { fs.unlinkSync('_tw_input.css'); } catch(e) {}
        try { fs.unlinkSync('tailwind.config.js'); } catch(e) {}
    }
})();

// ── Copy Assets ─────────────────────────────────────────────────────────────

var assetsDir = 'Assets';
if (fs.existsSync(assetsDir)) {
    var destAssets = path.join(DIST_DIR, 'Assets');
    fs.cpSync(assetsDir, destAssets, { recursive: true });
    var assetCount = fs.readdirSync(destAssets).length;
    console.log("   Copied " + assetCount + " asset(s) to dist/Assets/");
}

// ── Generate sitemap.xml ────────────────────────────────────────────────────

if (sitemapDomain) {
    var urls = processedPages.filter(function(file) {
        if (file === '404.html') return false;
        var flatSlug = file.replace('.html', '').split('/').pop();
        return !(pageRobots[flatSlug + '.html'] && pageRobots[flatSlug + '.html'].excludeSitemap);
    }).map(function(file) {
        var pagePath = file.replace('.html', '');
        var isIndex = pagePath === 'index' || pagePath === 'home';
        var loc = isIndex ? sitemapDomain + '/' : sitemapDomain + '/' + pagePath;
        return '  <url>\n    <loc>' + loc + '</loc>\n  </url>';
    });

    var sitemapXml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        urls.join('\n') + '\n' +
        '</urlset>';

    fs.writeFileSync(path.join(DIST_DIR, 'sitemap.xml'), sitemapXml, 'utf8');
    console.log("   Generated sitemap.xml with " + urls.length + " URL(s)");

    // Generate robots.txt
    var robotsTxt = 'User-agent: *\nAllow: /\nSitemap: ' + sitemapDomain + '/sitemap.xml';

    fs.writeFileSync(path.join(DIST_DIR, 'robots.txt'), robotsTxt, 'utf8');
    console.log('   Generated robots.txt');

    // Generate ai.txt
    var orgName = (config && config.organization) || '';
    if (!orgName) {
        try {
            orgName = path.basename(process.cwd()).replace(/[\-_.]/g, ' ').replace(/\s+/g, ' ').trim();
        } catch(e) {}
    }
    var contactEmail = siteData.email || siteData.contact_email || '';
    var contactPhone = siteData.phone || '';

    var aiTxtLines = [
        '# ai.txt — AI Usage Policy',
        '# Learn more: https://site.spawning.ai/spawning-ai-txt',
        ''
    ];

    if (orgName) aiTxtLines.push('# Organization: ' + orgName);
    if (sitemapDomain) aiTxtLines.push('# Website: ' + sitemapDomain);
    if (contactEmail) aiTxtLines.push('# Contact: ' + contactEmail);
    if (contactPhone) aiTxtLines.push('# Phone: ' + contactPhone);
    aiTxtLines.push('');

    aiTxtLines.push('# AI Policy');
    aiTxtLines.push('User-Agent: *');
    aiTxtLines.push('Disallow: training');
    aiTxtLines.push('Disallow: scraping');
    aiTxtLines.push('Allow: search-engine-indexing');
    aiTxtLines.push('Allow: summarization');

    fs.writeFileSync(path.join(DIST_DIR, 'ai.txt'), aiTxtLines.join('\n'), 'utf8');
    console.log('   Generated ai.txt');
} else {
    console.log('   No domain in build-config.json - skipping sitemap/robots/ai.txt');
}

// ── Generate _redirects for nested URL slugs ────────────────────────────────

var redirectLines = [];

// Read any existing manual _redirects file
if (fs.existsSync('_redirects')) {
    var existingRedirects = fs.readFileSync('_redirects', 'utf8').trim();
    if (existingRedirects) {
        redirectLines.push('# ── Manual redirects ──');
        redirectLines.push(existingRedirects);
        redirectLines.push('');
    }
}

// Generate 301 redirects from old flat URLs to nested clean URLs
var childSlugsForRedirect = Object.keys(pageParents);
if (childSlugsForRedirect.length > 0) {
    redirectLines.push('# ── Nested URL 301 redirects (auto-generated) ──');
    for (var ri = 0; ri < childSlugsForRedirect.length; ri++) {
        var childSlug = childSlugsForRedirect[ri];
        var nestedPath = resolveNestedPath(childSlug, pageParents);
        // 301 from flat URL to nested clean URL
        redirectLines.push('/' + childSlug + '  /' + nestedPath + '  301');
        // Also redirect the .html version
        redirectLines.push('/' + childSlug + '.html  /' + nestedPath + '  301');
    }
    console.log('   Redirects: generated ' + childSlugsForRedirect.length + ' nested URL 301 redirect(s)');
}

if (redirectLines.length > 0) {
    fs.writeFileSync(path.join(DIST_DIR, '_redirects'), redirectLines.join('\n') + '\n', 'utf8');
    console.log('   Wrote _redirects to dist/');
} else if (fs.existsSync('_redirects')) {
    // Fallback: just copy existing _redirects if no auto-generation happened
    fs.copyFileSync('_redirects', path.join(DIST_DIR, '_redirects'));
    console.log('   Copied _redirects');
}

console.log('');
console.log('Build complete! Output: ' + DIST_DIR + '/');