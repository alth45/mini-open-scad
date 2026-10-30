// Sidebar active-link highlight + smooth anchor scroll
(function () {
    const links = Array.from(document.querySelectorAll('.nav a[href^="#"]'));
    const byId = new Map();
    links.forEach(a => {
        const id = a.getAttribute('href').slice(1);
        if (id) byId.set(id, a);
    });

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const link = byId.get(entry.target.id);
            if (!link) return;
            links.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
        });
    }, { rootMargin: '-70px 0px -70% 0px', threshold: 0 });

    document.querySelectorAll('section[id], .fn[id]').forEach(el => observer.observe(el));

    // Copy anchor hint on hover of function anchors
    document.querySelectorAll('.fn').forEach(fn => {
        if (!fn.id) return;
        const name = fn.querySelector('.fn-name');
        if (name) name.title = 'Link ke #' + fn.id;
    });
})();