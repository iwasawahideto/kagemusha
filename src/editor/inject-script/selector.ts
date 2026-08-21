// Selector strategy — compute a Playwright-compatible selector string for a
// recorded element. Priority order targets stability:
//
//   1. data-testid           — explicit test hook, the most stable signal
//   2. aria-label            — semantic, survives layout/style changes
//   3. role + text (button/link with short text content)
//   4. text="..."            — exact text match
//   5. minimal CSS path      — fallback when nothing better is available
//
// Returns `{ selector, quality }`. `quality: "fallback"` means the result
// is a brittle CSS path; the steps panel surfaces this with a ⚠ icon so
// the user knows to add a data-testid to that element.
//
// Pure function — no DOM mutation, no editor state. Tested without a page.

export interface SelectorResult {
	selector: string;
	quality: "good" | "fallback";
}

const escapeQuotes = (s: string): string => s.replace(/"/g, '\\"');

// Roughly mirrors Playwright's role inference for elements without an
// explicit `role` attribute. Limited to the cases the editor cares about.
const inferRole = (el: Element): string | null => {
	const tag = el.tagName;
	if (tag === "BUTTON") return "button";
	if (tag === "A" && el.hasAttribute("href")) return "link";
	if (tag === "INPUT") {
		const type = (el as HTMLInputElement).type;
		if (type === "button" || type === "submit") return "button";
		if (type === "checkbox") return "checkbox";
		if (type === "radio") return "radio";
	}
	return null;
};

const isInteractiveAncestor = (el: Element): Element | null => {
	// Walk up to the nearest interactive ancestor — useful when the user
	// clicks on an icon inside a <button>.
	let cur: Element | null = el;
	while (cur) {
		if (
			cur.tagName === "BUTTON" ||
			cur.tagName === "A" ||
			cur.getAttribute("role") === "button" ||
			cur.getAttribute("role") === "link" ||
			cur.hasAttribute("data-testid")
		) {
			return cur;
		}
		cur = cur.parentElement;
	}
	return null;
};

const isUsableId = (id: string): boolean => /^[a-zA-Z][\w-]*$/.test(id);

// `force` writes nth-of-type even for an only child — needed when a duplicated
// id upstream makes the implicit "only element of its tag" ambiguous.
const typeSegment = (node: Element, force = false): string => {
	const tag = node.tagName.toLowerCase();
	const parent = node.parentElement;
	if (!parent) return tag;
	const siblings = Array.from(parent.children).filter(
		(c) => c.tagName === node.tagName,
	);
	if (siblings.length > 1 || force) {
		return `${tag}:nth-of-type(${siblings.indexOf(node) + 1})`;
	}
	return tag;
};

// Build a stable-ish CSS selector by walking up to the first ancestor with
// a unique id/class, then using nth-child from there. We deliberately keep
// the result short (max 4 segments) — long paths are signal that nothing
// stable was available, and the user should add a data-testid.
const cssPath = (el: Element): string => {
	const parts: string[] = [];
	let cur: Element | null = el;
	let depth = 0;
	while (cur && depth < 4 && cur !== document.body) {
		if (isUsableId(cur.id)) {
			parts.unshift(`#${cur.id}`);
			break;
		}
		parts.unshift(typeSegment(cur));
		cur = cur.parentElement;
		depth++;
	}
	return parts.join(" > ");
};

const attributeSelectors = (el: Element): string[] => {
	const out: string[] = [];
	const testId = el.getAttribute("data-testid");
	if (testId) out.push(`[data-testid="${escapeQuotes(testId)}"]`);
	const ariaLabel = el.getAttribute("aria-label");
	if (ariaLabel) out.push(`[aria-label="${escapeQuotes(ariaLabel)}"]`);
	if (isUsableId(el.id)) out.push(`#${el.id}`);
	return out;
};

// Most-anchored first. No depth cut-off unlike cssPath: a truncated path loses
// its anchor and matches every card of a grid instead of the one scrolled.
const containerPaths = (el: Element): string[] => {
	const anchored: string[] = [];
	const parts: string[] = [];
	const forced: string[] = [];
	let cur: Element | null = el;
	while (cur && cur !== document.body && cur !== document.documentElement) {
		const id = isUsableId(cur.id) ? `#${cur.id}` : null;
		parts.unshift(id ?? typeSegment(cur));
		forced.unshift(typeSegment(cur, true));
		if (id) anchored.push(parts.join(" > "));
		cur = cur.parentElement;
	}
	const root = cur === document.body ? "body" : "html";
	return [
		...anchored,
		[root, ...parts].join(" > "),
		[root, ...forced].join(" > "),
	];
};

// Live DOM at record time; replay differences are covered by capture's first-visible.
const matchesOnlyOne = (selector: string): boolean => {
	try {
		return document.querySelectorAll(selector).length === 1;
	} catch {
		return false;
	}
};

// A unique path is still "fallback" when anchorless — the steps panel flags it with ⚠.
const pathQuality = (selector: string): SelectorResult["quality"] =>
	/^[#[]/.test(selector) ? "good" : "fallback";

// Structural, because text=/interactive-ancestor resolve to elements without the
// overflow; uniqueness is verified since a grid's first candidate matches every card.
export const computeContainerSelector = (el: Element): SelectorResult => {
	const candidates = [...attributeSelectors(el), ...containerPaths(el)];
	const unique = candidates.find(matchesOnlyOne);
	if (unique) return { selector: unique, quality: pathQuality(unique) };
	return {
		selector: candidates.at(-1) ?? cssPath(el),
		quality: "fallback",
	};
};

export const computeSelector = (raw: Element): SelectorResult => {
	// Prefer an interactive ancestor — clicks on icons inside buttons should
	// select the button.
	const el = isInteractiveAncestor(raw) ?? raw;

	const testId = el.getAttribute("data-testid");
	if (testId) {
		return {
			selector: `[data-testid="${escapeQuotes(testId)}"]`,
			quality: "good",
		};
	}

	const ariaLabel = el.getAttribute("aria-label");
	if (ariaLabel) {
		return {
			selector: `[aria-label="${escapeQuotes(ariaLabel)}"]`,
			quality: "good",
		};
	}

	const role = el.getAttribute("role") ?? inferRole(el);
	const text = el.textContent?.trim();
	if (role && text && text.length > 0 && text.length < 50) {
		// Playwright recognizes `text="..."` as an exact-match selector,
		// which is more reliable than role= for kagemusha's use case.
		return { selector: `text="${escapeQuotes(text)}"`, quality: "good" };
	}

	if (text && text.length > 0 && text.length < 50 && !/\n/.test(text)) {
		return { selector: `text="${escapeQuotes(text)}"`, quality: "good" };
	}

	return { selector: cssPath(el), quality: "fallback" };
};
