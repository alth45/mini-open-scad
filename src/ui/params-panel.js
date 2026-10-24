export function createParamsPanel({ panelEl, bodyEl, titleEl, resetBtn, closeBtn, onChange }) {
    let params = [];
    let values = {};

    function row(label, child) {
        const row = document.createElement('div');
        row.className = 'param-row';
        if (label) {
            const l = document.createElement('label');
            l.textContent = label;
            row.appendChild(l);
        }
        row.appendChild(child);
        return row;
    }

    function buildControl(p) {
        const v = values[p.name];
        let input;

        switch (p.type) {
            case 'slider': {
                const wrap = document.createElement('div');
                wrap.className = 'param-slider-wrap';
                input = document.createElement('input');
                input.type = 'range';
                input.min = p.min;
                input.max = p.max;
                input.step = p.step;
                input.value = v;
                const num = document.createElement('span');
                num.className = 'param-num';
                num.textContent = v;
                input.addEventListener('input', () => {
                    const nv = parseFloat(input.value);
                    num.textContent = nv;
                    update(p.name, nv);
                });
                wrap.appendChild(input);
                wrap.appendChild(num);
                return wrap;
            }
            case 'number':
                input = document.createElement('input');
                input.type = 'number';
                input.step = p.step;
                input.value = v;
                input.addEventListener('input', () => {
                    const nv = parseFloat(input.value);
                    if (Number.isFinite(nv)) update(p.name, nv);
                });
                return input;

            case 'string':
                input = document.createElement('input');
                input.type = 'text';
                input.value = v;
                input.addEventListener('input', () => update(p.name, input.value));
                return input;

            case 'bool':
                input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = !!v;
                input.addEventListener('change', () => update(p.name, input.checked));
                return input;

            case 'color':
                input = document.createElement('input');
                input.type = 'color';
                input.value = v;
                input.addEventListener('input', () => update(p.name, input.value));
                return input;

            case 'enum':
                input = document.createElement('select');
                for (const opt of p.options) {
                    const o = document.createElement('option');
                    o.value = opt;
                    o.textContent = opt;
                    if (opt === v) o.selected = true;
                    input.appendChild(o);
                }
                input.addEventListener('change', () => update(p.name, input.value));
                return input;
        }
        return document.createTextNode('?');
    }

    function update(name, value) {
        values[name] = value;
        onChange(name, value, { ...values });
    }

    function render() {
        bodyEl.innerHTML = '';
        if (params.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'params-empty';
            empty.innerHTML =
                'Tidak ada parameter.<br>Tambah di kode:<br>' +
                '<code>// @param size {slider 10 100 50} Size</code>';
            bodyEl.appendChild(empty);
            return;
        }
        for (const p of params) {
            bodyEl.appendChild(row(p.label, buildControl(p)));
        }
    }

    /* Header klik → collapse */
    titleEl.addEventListener('click', () => {
        panelEl.classList.toggle('collapsed');
    });

    resetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const defs = {};
        for (const p of params) defs[p.name] = p.default;
        values = defs;
        render();
        onChange(null, null, { ...values });
    });

    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        panelEl.classList.add('hidden');
    });

    render();

    return {
        setParams(newParams, newValues) {
            params = newParams;
            values = { ...newValues };
            render();
        },
        isHidden: () => panelEl.classList.contains('hidden'),
        show: () => panelEl.classList.remove('hidden'),
        hide: () => panelEl.classList.add('hidden')
    };
}