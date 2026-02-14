// ======================================================
// Search Module — Fuzzy search with Fuse.js + Keywords
// ======================================================

export class SearchEngine {
    constructor(data, onSelect) {
        this.data = data;
        this.onSelect = onSelect;
        this.fuse = null;
        this.selectedIndex = -1;
        this.results = [];
        this._init();
    }

    _init() {
        // Build searchable list: merchants + categories
        const merchants = Object.keys(this.data.merchant_categories);
        const categories = [...new Set(Object.values(this.data.merchant_categories))];
        const merchantKeywords = this.data.merchant_keywords || {};

        this.searchItems = [
            ...merchants.map(m => ({
                name: m,
                type: 'merchant',
                category: this.data.merchant_categories[m],
                keywords: (merchantKeywords[m] || []).join(' ')
            })),
            ...categories.map(c => ({
                name: c,
                type: 'category',
                category: c,
                keywords: ''
            }))
        ];

        // Initialize Fuse.js with keyword searching
        this.fuse = new Fuse(this.searchItems, {
            keys: [
                { name: 'name', weight: 2 },      // Name matches are highest priority
                { name: 'keywords', weight: 1 },   // Keyword/nickname matches
                { name: 'category', weight: 0.5 }   // Category matches are lowest
            ],
            threshold: 0.4,      // tolerant for typos
            distance: 100,
            includeScore: true,
            minMatchCharLength: 1,
        });

        this._bindEvents();
    }

    _bindEvents() {
        const input = document.getElementById('merchantInput');
        const suggestions = document.getElementById('searchSuggestions');
        const searchBtn = document.getElementById('searchBtn');
        const amountInput = document.getElementById('amountInput');

        let debounceTimer;

        input.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                this._search(input.value);
            }, 120);
        });

        input.addEventListener('focus', () => {
            if (input.value.length > 0) {
                this._search(input.value);
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this._navigate(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this._navigate(-1);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (this.selectedIndex >= 0 && this.results[this.selectedIndex]) {
                    this._selectItem(this.results[this.selectedIndex].item);
                } else if (input.value.trim()) {
                    this._doCalculate();
                }
            } else if (e.key === 'Escape') {
                suggestions.classList.remove('visible');
            }
        });

        // Close suggestions on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-merchant')) {
                suggestions.classList.remove('visible');
            }
        });

        searchBtn.addEventListener('click', () => {
            this._doCalculate();
        });

        amountInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this._doCalculate();
            }
        });
    }

    _search(query) {
        const suggestions = document.getElementById('searchSuggestions');

        if (!query || query.length === 0) {
            suggestions.classList.remove('visible');
            this.results = [];
            return;
        }

        this.results = this.fuse.search(query).slice(0, 8);
        this.selectedIndex = -1;

        if (this.results.length === 0) {
            suggestions.classList.remove('visible');
            return;
        }

        suggestions.innerHTML = this.results.map((r, i) => {
            const matchStr = this._getMatchHint(r, query);
            return `
      <div class="suggestion-item ${i === this.selectedIndex ? 'active' : ''}" data-index="${i}">
        <span class="suggestion-name">${r.item.name}</span>
        <span class="suggestion-category">${matchStr || r.item.category}</span>
      </div>
    `;
        }).join('');

        suggestions.querySelectorAll('.suggestion-item').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.dataset.index);
                this._selectItem(this.results[idx].item);
            });

            el.addEventListener('mouseenter', () => {
                suggestions.querySelectorAll('.suggestion-item').forEach(s => s.classList.remove('active'));
                el.classList.add('active');
            });
        });

        suggestions.classList.add('visible');
    }

    /**
     * Show a hint about WHY this result matched (especially for keyword matches)
     */
    _getMatchHint(fuseResult, query) {
        const item = fuseResult.item;
        const q = query.toLowerCase();

        // If the name itself contains the query, no special hint needed
        if (item.name.toLowerCase().includes(q)) return '';

        // If matched via keyword, show which keyword
        if (item.keywords) {
            const kws = item.keywords.split(' ');
            const matched = kws.find(kw => kw.toLowerCase().includes(q) || q.includes(kw.toLowerCase()));
            if (matched) return `"${matched}" → ${item.category}`;
        }

        return item.category;
    }

    _navigate(direction) {
        const suggestions = document.getElementById('searchSuggestions');
        if (this.results.length === 0) return;

        this.selectedIndex = Math.max(-1, Math.min(this.results.length - 1, this.selectedIndex + direction));

        suggestions.querySelectorAll('.suggestion-item').forEach((el, i) => {
            el.classList.toggle('active', i === this.selectedIndex);
        });
    }

    _selectItem(item) {
        const input = document.getElementById('merchantInput');
        const suggestions = document.getElementById('searchSuggestions');

        input.value = item.name;
        input.dataset.type = item.type;
        input.dataset.category = item.category;
        suggestions.classList.remove('visible');

        // Auto-focus amount input
        document.getElementById('amountInput').focus();
    }

    _doCalculate() {
        const input = document.getElementById('merchantInput');
        const amountInput = document.getElementById('amountInput');
        const merchantName = input.value.trim();
        const amount = parseFloat(amountInput.value) || 1000;

        if (!merchantName) return;

        // Try to resolve via fuzzy search
        const fuzzyResult = this.fuse.search(merchantName);
        let resolvedItem;

        if (fuzzyResult.length > 0) {
            resolvedItem = fuzzyResult[0].item;
        } else {
            // Fallback: treat as unknown merchant, try category fallback
            resolvedItem = { name: merchantName, type: 'category', category: 'Shopping' };
        }

        this.onSelect(resolvedItem, amount);
    }

    // Programmatic search (for merchant pages)
    searchFor(merchantName, amount) {
        const input = document.getElementById('merchantInput');
        const amountInput = document.getElementById('amountInput');

        input.value = merchantName;
        amountInput.value = amount;

        const fuzzyResult = this.fuse.search(merchantName);
        const resolvedItem = fuzzyResult.length > 0
            ? fuzzyResult[0].item
            : { name: merchantName, type: 'category', category: 'Shopping' };

        this.onSelect(resolvedItem, amount);
    }
}
