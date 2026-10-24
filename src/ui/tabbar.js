export function createTabBar(containerEl) {
    function render(tabs, activeId, callbacks) {
        containerEl.innerHTML = '';

        for (const tab of tabs) {
            const el = document.createElement('div');
            el.className = 'tab' + (tab.id === activeId ? ' active' : '');
            el.dataset.id = tab.id;

            const name = document.createElement('span');
            name.className = 'tab-name';
            name.textContent = tab.name;
            name.title = 'Double-click untuk rename';
            el.appendChild(name);

            const close = document.createElement('button');
            close.className = 'tab-close';
            close.textContent = '×';
            close.title = 'Close tab';
            close.disabled = tabs.length === 1;
            el.appendChild(close);

            el.addEventListener('click', (e) => {
                if (e.target === close) return;
                callbacks.onSelect?.(tab.id);
            });

            close.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!close.disabled) callbacks.onClose?.(tab.id);
            });

            el.addEventListener('auxclick', (e) => {
                if (e.button === 1 && tabs.length > 1) {
                    e.preventDefault();
                    callbacks.onClose?.(tab.id);
                }
            });

            name.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                startRename(el, name, tab, callbacks.onRename);
            });

            containerEl.appendChild(el);
        }

        const add = document.createElement('button');
        add.className = 'tab-add';
        add.textContent = '+';
        add.title = 'New tab';
        add.addEventListener('click', () => callbacks.onAdd?.());
        containerEl.appendChild(add);
    }

    function startRename(parentEl, nameEl, tab, onRename) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tab-rename-input';
        input.value = tab.name;
        input.addEventListener('click', (e) => e.stopPropagation());

        parentEl.replaceChild(input, nameEl);
        input.focus();
        input.select();

        let done = false;
        const finish = (commit) => {
            if (done) return;
            done = true;
            if (commit) {
                onRename?.(tab.id, input.value);
            } else {
                parentEl.replaceChild(nameEl, input);
            }
        };

        input.addEventListener('blur', () => finish(true));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); finish(true); }
            if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        });
    }

    return { render };
}