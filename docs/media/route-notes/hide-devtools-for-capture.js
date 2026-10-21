// Media capture only: hide the TanStack Router and TanStack Query devtools
// toggle buttons. Product content is not touched.
(() => {
	const DEVTOOLS = /tanstack|query devtools|router devtools/i;
	const hide = (root) => {
		for (const button of root.querySelectorAll("button")) {
			const label = `${button.getAttribute("aria-label") ?? ""} ${button.getAttribute("title") ?? ""} ${button.textContent ?? ""}`;
			if (!DEVTOOLS.test(label)) continue;
			button.style.setProperty("display", "none", "important");
			// The Query devtools logo glow sits beside its button in a wrapper
			// that holds nothing else, so hide that wrapper too.
			const wrapper = button.parentElement;
			if (wrapper && wrapper !== document.body && wrapper.querySelectorAll("button").length === 1 && !wrapper.textContent?.replace(button.textContent ?? "", "").trim())
				wrapper.style.setProperty("display", "none", "important");
		}
	};
	const start = () => {
		hide(document);
		new MutationObserver(() => hide(document)).observe(document.documentElement, { childList: true, subtree: true });
	};
	if (document.documentElement) start();
	else document.addEventListener("DOMContentLoaded", start);
})();
