// ======================================================
// Router — Hash-based SPA routing
// ======================================================

export class Router {
    constructor() {
        this.routes = {};
        this._currentRoute = null;
    }

    on(pattern, handler) {
        this.routes[pattern] = handler;
        return this;
    }

    start() {
        window.addEventListener('hashchange', () => this._resolve());
        // Initial route
        this._resolve();
    }

    navigate(hash) {
        window.location.hash = hash;
    }

    _resolve() {
        const hash = window.location.hash || '#/';

        // Try exact match first
        if (this.routes[hash]) {
            this._currentRoute = hash;
            this.routes[hash]();
            return;
        }

        // Try pattern matching for /merchant/:name
        for (const pattern in this.routes) {
            const regex = this._patternToRegex(pattern);
            const match = hash.match(regex);
            if (match) {
                this._currentRoute = hash;
                const params = this._extractParams(pattern, match);
                this.routes[pattern](params);
                return;
            }
        }

        // Fallback to home
        if (this.routes['#/']) {
            this._currentRoute = '#/';
            this.routes['#/']();
        }
    }

    _patternToRegex(pattern) {
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const withParams = escaped.replace(/:([a-zA-Z]+)/g, '([^/]+)');
        return new RegExp('^' + withParams + '$');
    }

    _extractParams(pattern, match) {
        const paramNames = [];
        const paramRegex = /:([a-zA-Z]+)/g;
        let m;
        while ((m = paramRegex.exec(pattern)) !== null) {
            paramNames.push(m[1]);
        }

        const params = {};
        paramNames.forEach((name, i) => {
            params[name] = decodeURIComponent(match[i + 1]);
        });
        return params;
    }
}
