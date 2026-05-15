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

// Build a stable-ish CSS selector by walking up to the first ancestor with
// a unique id/class, then using nth-child from there. We deliberately keep
// the result short (max 4 segments) — long paths are signal that nothing
// stable was available, and the user should add a data-testid.
const cssPath = (el: Element): string => {
	const parts: string[] = [];
	let cur: Element | null = el;
	let depth = 0;
	while (cur && depth < 4 && cur !== document.body) {
		const node: Element = cur;
		const tag = node.tagName;
		let segment = tag.toLowerCase();
		const id = node.id;
		if (id && /^[a-zA-Z][\w-]*$/.test(id)) {
			parts.unshift(`#${id}`);
			break;
		}
		const parent = node.parentElement;
		if (parent) {
			const siblings = Array.from(parent.children).filter(
				(c) => c.tagName === tag,
			);
			if (siblings.length > 1) {
				const idx = siblings.indexOf(node) + 1;
				segment += `:nth-of-type(${idx})`;
			}
		}
		parts.unshift(segment);
		cur = parent;
		depth++;
	}
	return parts.join(" > ");
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
