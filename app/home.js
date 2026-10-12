(function (root) {
  'use strict';

  // The home screen owns its requests and DOM. Disposing it invalidates every
  // continuation, so a slow feed cannot overwrite another library or profile.
  function Home(options) {
    this.options = options;
    this.host = options.host;
    this.rows = [];
    this.disposed = false;
    this.frame = null;
    this.timer = null;
    this.ready = false;
    this.secondaryReady = false;
    this.restore = options.restore;
    this.requests = [];
    this.column = 0;
  }

  Home.prototype.mount = function (sections, prefetch) {
    var self = this;
    this.host.classList.add('home-view');
    var title = document.createElement('h1');
    title.textContent = 'Home';
    this.host.appendChild(title);
    this.addRow('continue', 'Continue watching', '/hubs/continueWatching/items', 'continue');
    sections.forEach(function (section) {
      self.addRow('recent-' + section.key, 'Recently added in ' + section.title,
        '/library/sections/' + encodeURIComponent(section.key) + '/recentlyAdded', section.key);
    });
    this.host.onscroll = function () {
      cancelAnimationFrame(self.frame);
      self.frame = requestAnimationFrame(function () { self.loadVisible(); });
    };
    this.focusChanged = function () {
      cancelAnimationFrame(self.focusFrame);
      self.focusFrame = requestAnimationFrame(function () { self.compactPending(); });
    };
    this.host.addEventListener('focusout', this.focusChanged);
    this.load(this.rows[0], prefetch);
  };

  Home.prototype.deferRows = function () {
    if (this.secondaryScheduled) return;
    this.secondaryScheduled = true;
    var self = this;
    // Wait for an actual paint opportunity, not a timer started while the
    // initial request is still pending. This keeps new feeds off startup's path.
    this.secondaryFrame = requestAnimationFrame(function () {
      self.secondaryFrame = requestAnimationFrame(function () {
        self.timer = setTimeout(function () {
          if (self.disposed) return;
          self.secondaryReady = true;
          self.loadVisible();
        }, 150);
      });
    });
  };

  Home.prototype.addRow = function (id, title, path, section) {
    var self = this, node = document.createElement('section');
    node.className = 'home-row';
    node.setAttribute('aria-label', title);
    var heading = document.createElement('div');
    heading.className = 'home-row-heading';
    var label = document.createElement('h2');
    label.textContent = title;
    heading.appendChild(label);
    var all = document.createElement('button');
    all.type = 'button';
    all.textContent = 'View all';
    all.setAttribute('aria-label', 'View all ' + title);
    all.setAttribute('data-home-focus', id + ':all');
    all.title = 'Right from the last title opens View all. Left returns to the titles.';
    all.onclick = function () { self.options.browse({title: title, path: row.path, page: 0, section: section}, id + ':all'); };
    heading.appendChild(all);
    node.appendChild(heading);
    var grid = document.createElement('div');
    grid.className = 'grid home-grid';
    grid.setAttribute('aria-busy', 'true');
    node.appendChild(grid);
    var row = {id: id, title: title, path: path, section: section, node: node, grid: grid, loading: false, loaded: false};
    this.rows.push(row);
    this.host.appendChild(node);
    this.message(row, 'Loading titles…');
  };

  Home.prototype.message = function (row, text, retry) {
    var self = this, status = document.createElement('div');
    status.className = 'home-row-message';
    var message = document.createElement('p');
    message.textContent = text;
    status.appendChild(message);
    if (retry) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Retry';
      button.setAttribute('aria-label', 'Retry ' + row.title);
      button.setAttribute('data-home-focus', row.id + ':retry');
      button.onclick = function () { row.failed = false; self.load(row); };
      status.appendChild(button);
    }
    row.grid.textContent = '';
    row.grid.appendChild(status);
  };

  Home.prototype.load = function (row, prefetch) {
    if (this.disposed || row.loading || row.loaded || row.failed) return;
    var self = this;
    row.loading = true;
    row.grid.setAttribute('aria-busy', 'true');
    var request = prefetch || this.options.request(row.path + '?X-Plex-Container-Start=0&X-Plex-Container-Size=' + this.options.columns);
    this.requests.push(request);
    function settled() {
      var index = self.requests.indexOf(request);
      if (index >= 0) self.requests.splice(index, 1);
    }
    request.then(function (data) {
      settled();
      if (self.disposed) return;
      row.loading = false;
      row.loaded = true;
      row.grid.setAttribute('aria-busy', 'false');
      row.items = self.options.extract(data).items.slice(0, self.options.columns);
      var retryFocused = document.activeElement.getAttribute('data-home-focus') === row.id + ':retry';
      self.render(row);
      if (retryFocused) self.focusRow(row, 0);
      if (!self.ready) { self.ready = true; self.options.ready(); }
      if (row.id === 'continue') self.deferRows();
      self.restoreFocus();
      self.loadVisible();
      if (self.options.updated) self.options.updated(self.rows);
    }).catch(function (error) {
      settled();
      if (self.disposed) return;
      row.loading = false;
      row.grid.setAttribute('aria-busy', 'false');
      if (row.id === 'continue' && row.path.indexOf('/hubs/') === 0 && /HTTP (400|404)/.test(error.message)) {
        row.path = '/library/onDeck';
        self.load(row);
        return;
      }
      row.failed = true;
      var retryFocused = document.activeElement.getAttribute('data-home-focus') === row.id + ':retry';
      self.message(row, 'These titles are unavailable. Other rows are still usable.', true);
      if (row.id === 'continue') self.deferRows();
      if (retryFocused) self.focusRow(row, 0);
      self.restoreFocus();
    });
  };

  Home.prototype.render = function (row) {
    var self = this;
    row.grid.textContent = '';
    row.rendered = true;
    if (!row.items.length) {
      this.message(row, row.id === 'continue' ? 'Nothing in progress. Find something new below.' : 'No recent titles in this library.');
      this.compact(row);
      return;
    }
    row.items.forEach(function (item, index) {
      var key = row.id + ':' + index;
      var card = self.options.card(item, function () { self.options.open(item, key); }, row.id === 'continue');
      card.setAttribute('data-home-focus', key);
      row.grid.appendChild(card);
    });
  };

  Home.prototype.compact = function (row) {
    if (this.disposed || row.node.classList.contains('home-row-empty')) return;
    var anchor = this.host.contains(document.activeElement) ? document.activeElement : null;
    var scroll = this.host.scrollTop, height = this.host.clientHeight;
    // Rolling back an impossible scroll compensation can itself emit scroll.
    // Retry only after focus, scroll position or viewport size has changed.
    if (row.compactPending && row.compactAnchor === anchor && row.compactScroll === scroll && row.compactHeight === height) return;
    var before = anchor ? anchor.getBoundingClientRect().top : 0;
    row.node.classList.add('home-row-empty');
    row.compactPending = false;
    if (!anchor) return;
    var scale = this.host.getBoundingClientRect().height / this.host.offsetHeight || 1;
    this.host.scrollTop += (anchor.getBoundingClientRect().top - before) / scale;
    if (Math.abs(anchor.getBoundingClientRect().top - before) <= 1) return;
    // At either scroll boundary the required offset may be impossible. Keep
    // the row's space temporarily rather than move the current control, then
    // retry when navigation makes the collapse safe (including leaving Home).
    row.node.classList.remove('home-row-empty');
    this.host.scrollTop = scroll;
    row.compactPending = true;
    row.compactAnchor = anchor;
    row.compactScroll = this.host.scrollTop;
    row.compactHeight = height;
  };

  Home.prototype.compactPending = function () {
    if (this.disposed) return;
    var self = this;
    this.rows.forEach(function (row) { if (row.compactPending) self.compact(row); });
  };

  Home.prototype.restoreFocus = function () {
    if (this.pendingFocus) {
      var pending = this.pendingFocus;
      var row = this.rows[pending.row];
      if (document.activeElement !== pending.anchor) {
        this.pendingFocus = null;
      } else if (row.loaded || row.failed) {
        this.pendingFocus = null;
        this.focusRow(row, pending.column);
      }
      return;
    }
    var key = this.restore || 'continue:0';
    var target = Array.prototype.filter.call(this.host.querySelectorAll('[data-home-focus]'), function (node) {
      return node.getAttribute('data-home-focus') === key;
    })[0];
    if (!target && !this.restore && (this.rows[0].loaded || this.rows[0].failed)) {
      target = this.rows[0].grid.querySelector('button') || this.rows[0].node.querySelector('button');
    }
    if (target && !this.focusRestored) {
      // Never steal focus from a user who navigated while a feed was loading.
      if (!this.host.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON') target.focus();
      this.focusRestored = true;
      this.restore = null;
    }
  };

  Home.prototype.focusRow = function (row, column) {
    if (row.loaded && !row.rendered) this.render(row);
    var cards = row.grid.querySelectorAll('.card');
    var target = cards[Math.min(column, cards.length - 1)] || row.grid.querySelector('button') || row.node.querySelector('button');
    if (target) {
      target.focus();
      target.scrollIntoView({block: 'nearest', inline: 'nearest'});
      this.host.scrollLeft = 0;
    }
  };

  Home.prototype.goToRow = function (index, column) {
    var row = this.rows[index];
    if (!row) return true;
    if (row.loaded || row.failed) this.focusRow(row, column);
    else {
      // Keep a real, usable focus target while loading. Another direction key
      // cancels this pending handoff so a late response cannot pull focus back.
      var anchor = row.node.querySelector('button');
      anchor.focus();
      anchor.scrollIntoView({block: 'nearest', inline: 'nearest'});
      this.pendingFocus = {row: index, column: column, anchor: anchor};
      this.load(row);
    }
    return true;
  };

  Home.prototype.move = function (key) {
    var current = document.activeElement;
    if (!this.host.contains(current)) return false;
    if (key < 37 || key > 40) return false;
    this.pendingFocus = null;
    var rowIndex = -1;
    this.rows.some(function (row, index) {
      if (!row.node.contains(current)) return false;
      rowIndex = index;
      return true;
    });
    if (rowIndex < 0) return false;
    var row = this.rows[rowIndex], cards = row.grid.querySelectorAll('.card');
    var column = Array.prototype.indexOf.call(cards, current);
    if (key === 38 || key === 40) {
      if (key === 38 && rowIndex === 0) {
        if (this.options.leave) { this.options.leave(); return true; }
        return false;
      }
      // Preserve the preferred column across a partial/empty row, so Down then
      // Up is symmetrical even when one row has fewer than six titles.
      if (column >= 0 && column !== Math.min(this.column, cards.length - 1)) this.column = column;
      return this.goToRow(rowIndex + (key === 38 ? -1 : 1), this.column);
    }
    if (column < 0) {
      if (key === 37 && cards.length) {
        this.column = cards.length - 1;
        this.focusRow(row, this.column);
      } else if (key === 37 && !row.loaded && !row.failed) {
        this.column = this.options.columns - 1;
        return this.goToRow(rowIndex, this.column);
      } else if (key === 37 && row.failed) this.focusRow(row, this.column);
      else if (key === 39) row.node.querySelector('button').focus();
      return true;
    }
    if (key === 39 && column === cards.length - 1) {
      this.column = column;
      row.node.querySelector('button').focus();
    } else {
      this.column = Math.max(0, column + (key === 37 ? -1 : 1));
      this.focusRow(row, this.column);
    }
    return true;
  };

  Home.prototype.loadVisible = function () {
    if (this.disposed) return;
    this.compactPending();
    var self = this, bounds = this.host.getBoundingClientRect();
    this.rows.forEach(function (row) {
      var rect = row.node.getBoundingClientRect();
      var wanted = rect.bottom >= bounds.top - 450 && rect.top <= bounds.bottom + 150;
      if (self.restore && self.restore.indexOf(row.id + ':') === 0) wanted = true;
      if (wanted) {
        if (row.id === 'continue' || self.secondaryReady || self.restore) self.load(row);
        if (row.loaded && !row.rendered) self.render(row);
      } else if (row.rendered && row.items.length && !row.node.contains(document.activeElement)) {
        row.grid.textContent = '';
        row.rendered = false;
      }
    });
    this.restoreFocus();
  };

  Home.prototype.dispose = function () {
    this.disposed = true;
    clearTimeout(this.timer);
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.secondaryFrame);
    cancelAnimationFrame(this.focusFrame);
    this.host.removeEventListener('focusout', this.focusChanged);
    this.requests.forEach(function (request) { if (request.abort) request.abort(); });
    this.host.onscroll = null;
    this.host.classList.remove('home-view');
  };

  root.TizenHome = Home;
}(this));
