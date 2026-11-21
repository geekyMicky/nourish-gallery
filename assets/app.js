class NourishApp {
  constructor() {
    this.storageKey = 'nourish-main-v5';
    this.legacyStorageKey = 'nourish-main-v4';
    this.pageSize = 45;
    this.state = { added: [], edits: {}, deleted: [] };
    this.catalog = { items: [], scents: {} };
    this.activeKind = '全部';
    this.activeScent = '全部';
    this.activePage = 1;
    this.visiblePages = 'all';
    this.sortBy = 'added-desc';
    this.$ = (selector) => document.querySelector(selector);
  }

  async init() {
    try {
      const response = await fetch('data/catalog.json');
      if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);
      this.catalog = await response.json();
      this.restoreState();
      this.bindEvents();
      this.renderGuide();
      this.render();
    } catch (error) {
      this.$('#grid').innerHTML = '<p class="empty">清单暂时没有加载成功。请刷新页面后再试。</p>';
      console.error(error);
    }
  }

  restoreState() {
    try {
      const saved = localStorage.getItem(this.storageKey) || localStorage.getItem(this.legacyStorageKey);
      if (saved) this.state = { ...this.state, ...JSON.parse(saved) };
    } catch (error) {
      console.warn('Could not restore local Nourish additions.', error);
    }
  }

  saveState() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.state));
  }

  bindEvents() {
    this.$('#search').addEventListener('input', () => this.resetAndRender());
    this.$('#sort-by').addEventListener('change', (event) => {
      this.sortBy = event.target.value;
      this.resetAndRender();
    });
    this.$('#categories').addEventListener('click', (event) => {
      const button = event.target.closest('[data-kind]');
      if (!button) return;
      this.activeKind = button.dataset.kind;
      this.resetAndRender();
    });
    this.$('#clear-scent').addEventListener('click', () => {
      this.activeScent = '全部';
      this.resetAndRender();
    });
    this.$('#page-size').addEventListener('click', (event) => {
      const button = event.target.closest('[data-pages]');
      if (!button) return;
      this.visiblePages = button.dataset.pages;
      this.activePage = 1;
      this.render();
    });
    this.$('#pager').addEventListener('click', (event) => {
      const button = event.target.closest('[data-page]');
      if (!button || button.disabled) return;
      this.activePage = Number(button.dataset.page);
      this.render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    this.$('#grid').addEventListener('click', (event) => this.handleGridClick(event));
    this.$('#add').addEventListener('submit', (event) => this.addItem(event));
    this.$('#guide-open').addEventListener('click', () => this.$('#guide').showModal());
    this.$('#guide-close').addEventListener('click', () => this.$('#guide').close());
  }

  handleGridClick(event) {
    const card = event.target.closest('.card');
    if (!card) return;
    const id = card.dataset.id;
    const chip = event.target.closest('[data-scent]');
    if (chip) {
      this.activeScent = chip.dataset.scent;
      this.resetAndRender();
      return;
    }
    if (event.target.closest('.edit-toggle')) {
      card.classList.toggle('editing');
      return;
    }
    if (event.target.closest('.delete')) {
      this.deleteItem(id);
      return;
    }
    if (event.target.closest('.save-edit')) this.saveEdit(card, id);
  }

  resetAndRender() {
    this.activePage = 1;
    this.render();
  }

  getItems() {
    const catalogItems = this.catalog.items.map((item, index) => ({
      ...item,
      ...this.state.edits[item.id],
      catalogIndex: index,
    }));
    const additions = this.state.added.map((item) => ({ ...item, catalogIndex: Number.MAX_SAFE_INTEGER }));
    return [...catalogItems, ...additions]
      .filter((item) => !this.state.deleted.includes(item.id))
      .map((item) => ({ ...item, kind: item.kind === '电影' ? '影视' : item.kind, tags: this.normalizeTags(item.tags) }));
  }

  normalizeTags(tags = []) {
    const known = Object.keys(this.catalog.scents);
    return [...new Set(tags.filter((tag) => known.includes(tag)))].slice(0, 3);
  }

  filteredItems() {
    const query = this.$('#search').value.trim().toLocaleLowerCase();
    return this.getItems()
      .filter((item) => {
        const title = `${item.title || ''} ${item.en || ''}`.toLocaleLowerCase();
        const itemQuadrants = this.quadrants(item.tags);
        return (!query || title.includes(query))
          && (this.activeKind === '全部' || item.kind === this.activeKind)
          && (this.activeScent === '全部' || item.tags.includes(this.activeScent) || itemQuadrants.includes(this.activeScent));
      })
      .sort((a, b) => this.compareItems(a, b));
  }

  compareItems(a, b) {
    if (this.sortBy === 'title-asc') return this.title(a).localeCompare(this.title(b), 'zh-Hans-CN');
    if (this.sortBy === 'title-desc') return this.title(b).localeCompare(this.title(a), 'zh-Hans-CN');
    if (this.sortBy === 'year-asc') return this.year(a) - this.year(b) || this.title(a).localeCompare(this.title(b), 'zh-Hans-CN');
    if (this.sortBy === 'year-desc') return this.year(b) - this.year(a) || this.title(a).localeCompare(this.title(b), 'zh-Hans-CN');
    return (b.addedAt || b.catalogIndex) - (a.addedAt || a.catalogIndex);
  }

  title(item) { return item.title || item.en || ''; }
  year(item) { return Number(String(item.year || '').match(/\d{4}/)?.[0]) || 0; }
  quadrants(tags) { return [...new Set(tags.map((tag) => this.catalog.scents[tag]?.[0]).filter(Boolean))]; }
  scentInfo(tag) { return this.catalog.scents[tag] || ['自定义', '私人标记，等待你为它写下自己的气味说明。']; }
  escape(value = '') { return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }

  render() {
    const items = this.filteredItems();
    const paged = this.paginate(items);
    this.renderFilters();
    this.$('#grid').innerHTML = paged.length
      ? paged.map((item) => this.cardMarkup(item)).join('')
      : '<p class="empty">没有找到相符的条目。</p>';
    this.$('#count').textContent = `${items.length} / ${this.getItems().length} 项`;
    this.renderPagination(items.length);
  }

  paginate(items) {
    if (this.visiblePages === 'all') return items;
    const start = (this.activePage - 1) * this.pageSize;
    return items.slice(start, start + this.pageSize);
  }

  renderFilters() {
    this.$('#categories').innerHTML = ['全部', '书籍', '影视', '其他']
      .map((kind) => `<button class="category ${kind === this.activeKind ? 'active' : ''}" type="button" data-kind="${kind}">${kind}</button>`)
      .join('');
    const clear = this.$('#clear-scent');
    clear.hidden = this.activeScent === '全部';
    clear.textContent = this.activeScent === '全部' ? '' : `${this.activeScent} ×`;
  }

  renderPagination(itemCount) {
    const pageCount = Math.max(1, Math.ceil(itemCount / this.pageSize));
    if (this.activePage > pageCount) this.activePage = pageCount;
    this.$('#page-size').innerHTML = ['all', '1', '5']
      .map((pages) => `<button class="size-button ${String(this.visiblePages) === pages ? 'active' : ''}" type="button" data-pages="${pages}">${pages === 'all' ? '全部' : `${pages} 页`}</button>`)
      .join('');
    if (this.visiblePages === 'all') {
      this.$('#pager').innerHTML = '';
      return;
    }
    const buttons = Array.from({ length: pageCount }, (_, index) => index + 1)
      .map((page) => `<button class="page-button ${page === this.activePage ? 'active' : ''}" type="button" data-page="${page}">${page}</button>`)
      .join('');
    this.$('#pager').innerHTML = buttons;
  }

  cardMarkup(item) {
    const tags = item.tags.length ? item.tags : ['桂花'];
    const image = item.image ? `<img src="${this.escape(item.image)}" alt="${this.escape(item.title)}" onerror="this.parentElement.classList.remove('has-image')">` : '';
    const chips = tags.map((tag) => `<button class="chip" type="button" data-scent="${this.escape(tag)}" data-tip="${this.escape(this.scentInfo(tag)[1])}">${this.escape(tag)}</button>`).join('');
    const credit = this.creditLine(item);
    return `<article class="card" data-id="${this.escape(item.id)}">
      <div class="visual ${item.image ? 'has-image' : ''}">${image}<div class="fallback">${this.escape(item.title)}</div>${item.pending ? '<span class="pending">✳ 待确认</span>' : ''}</div>
      <div class="body">
        <div class="meta">${this.escape(item.kind)}${item.genre ? ` / ${this.escape(item.genre)}` : ''}</div>
        <h2>${this.escape(item.title)}</h2>
        <p class="en">${this.escape(item.en) || ' '}</p>
        ${credit ? `<p class="credit">${this.escape(credit)}</p>` : ''}
        <div class="chips">${chips}</div>
        ${item.summary ? `<p class="summary">${this.escape(item.summary)}</p>` : ''}
        ${item.rec ? `<p class="rec">${this.escape(item.rec)}</p>` : ''}
        <div class="actions"><button class="plain edit-toggle" type="button">编辑</button><button class="plain delete" type="button">删除</button></div>
        ${this.editorMarkup(item, tags)}
      </div>
    </article>`;
  }

  creditLine(item) {
    const creator = [item.creatorZh, item.creatorEn].filter(Boolean).join(item.creatorZh && item.creatorEn ? ' / ' : '');
    const role = item.creatorRole || (item.kind === '书籍' ? '作者' : item.kind === '影视' ? '导演' : '创作者');
    return [item.year, creator ? `${role}：${creator}` : ''].filter(Boolean).join(' · ');
  }

  editorMarkup(item, tags) {
    const input = (field, label) => `<input data-field="${field}" value="${this.escape(item[field])}" placeholder="${label}">`;
    const options = ['书籍', '影视', '其他'].map((kind) => `<option value="${kind}" ${kind === item.kind ? 'selected' : ''}>${kind}</option>`).join('');
    return `<div class="editor">
      ${input('title', '中文名')}${input('en', '英文名')}<select data-field="kind">${options}</select>
      ${input('genre', '媒介 / 类型')}${input('year', '作品年份')}${input('creatorRole', '作者 / 导演')}
      ${input('creatorZh', '创作者中文名')}${input('creatorEn', '创作者英文名')}${input('tags', '气味标签，最多 3 个，以顿号分隔')}${input('image', '图片网址或本地路径（可选）')}
      <textarea data-field="summary" placeholder="简介（可选）">${this.escape(item.summary)}</textarea>
      <textarea data-field="rec" placeholder="推荐语（可选）">${this.escape(item.rec)}</textarea>
      <label><input type="checkbox" data-field="pending" ${item.pending ? 'checked' : ''}> 待确认</label>
      <button class="save-edit" type="button">保存修改</button>
    </div>`;
  }

  saveEdit(card, id) {
    const update = {};
    card.querySelectorAll('[data-field]').forEach((field) => {
      update[field.dataset.field] = field.type === 'checkbox' ? field.checked : field.value.trim();
    });
    update.tags = this.parseTags(update.tags);
    const addition = this.state.added.find((item) => item.id === id);
    if (addition) Object.assign(addition, update);
    else this.state.edits[id] = { ...this.state.edits[id], ...update };
    this.saveState();
    this.render();
  }

  deleteItem(id) {
    const additionIndex = this.state.added.findIndex((item) => item.id === id);
    if (additionIndex >= 0) this.state.added.splice(additionIndex, 1);
    else if (!this.state.deleted.includes(id)) this.state.deleted.push(id);
    this.saveState();
    this.resetAndRender();
  }

  addItem(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get('new-title') || '').trim();
    if (!title) return;
    this.state.added.push({
      id: `personal-${Date.now()}`,
      title,
      en: String(data.get('new-en') || '').trim(),
      kind: String(data.get('new-kind') || '其他'),
      genre: '', year: '', creatorZh: '', creatorEn: '', creatorRole: '', image: '',
      tags: this.parseTags(String(data.get('new-tags') || '')),
      summary: '', rec: '', pending: false, addedAt: Date.now(),
    });
    this.saveState();
    form.reset();
    this.resetAndRender();
  }

  parseTags(value) {
    return this.normalizeTags(String(value).split(/[，,、]/).map((tag) => tag.trim()).filter(Boolean));
  }

  renderGuide() {
    const groups = {};
    Object.entries(this.catalog.scents).forEach(([name, [quadrant, description]]) => {
      (groups[quadrant] ||= []).push({ name, description });
    });
    this.$('#guide-content').innerHTML = Object.entries(groups).map(([quadrant, scents]) => `<section class="guide-group"><h3>${this.escape(quadrant)}</h3>${scents.map((scent) => `<p><b>${this.escape(scent.name)}</b>：${this.escape(scent.description)}</p>`).join('')}</section>`).join('');
  }
}

document.addEventListener('DOMContentLoaded', () => new NourishApp().init());
