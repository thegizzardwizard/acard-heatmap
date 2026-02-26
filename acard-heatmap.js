import { LitElement, html, css } from "https://unpkg.com/lit@3.1.2/index.js?module";
import { styleMap } from "https://unpkg.com/lit@3.1.2/directives/style-map.js?module";

// Helper Functions
function parseTime(t) {
  if (!t) return 0;
  const parts = t.split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1] || 0);
}

function formatMins(mins) {
  let h = Math.floor(mins / 60);
  let m = mins % 60;
  let ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  h = h ? h : 12;
  let mm = m < 10 ? '0' + m : m;
  return mm === '00' ? `${h}${ampm}` : `${h}:${mm}${ampm}`;
}

function hexToRgb(hex) {
  let c = hex.substring(1).split('');
  if (c.length == 3) c = [c[0], c[0], c[1], c[1], c[2], c[2]];
  c = '0x' + c.join('');
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

function rgbToHex(r, g, b) {
  return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1);
}

function interpolateColor(color1, color2, factor) {
  let result = color1.slice();
  for (let i = 0; i < 3; i++) result[i] = Math.round(result[i] + factor * (color2[i] - color1[i]));
  return result;
}

// --- MAIN CARD ---
class ACardHeatmap extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
      _resolvedEntities: { type: Array },
      _renderRows: { type: Array },
      rollingDays: { type: Array },
      _staticTime: { type: String },
      _isLoading: { type: Boolean }
    };
  }

  constructor() {
    super();
    this._resolvedEntities = [];
    this._renderRows = [];
    this.eventsCountByEntity = {};
    this.tripTimesByEntity = {};
    this.rollingDays = [];
    this._refreshInterval = null;
    this._staticTime = "";
    this._isLoading = true;
  }

  static get styles() {
    return css`
      ha-card { padding: 16px; display: flex; flex-direction: column; }
      .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
      .header-title { font-size: 18px; font-weight: 600; }
      .entities-container { display: flex; flex-direction: column; }
      .entity-wrapper { display: flex; flex-direction: column; }
      .entity-name { font-size: 14px; font-weight: 500; color: var(--primary-text-color); margin-bottom: 8px; }
      .heatmap-table { display: flex; flex-direction: column; overflow-x: auto; padding-bottom: 8px; }
      .hm-row { display: flex; align-items: center; width: max-content; }
      .hm-time-label { font-size: 12px; color: var(--secondary-text-color); text-align: right; padding-right: 12px; white-space: nowrap; flex-shrink: 0; position: sticky; left: 0; background: var(--ha-card-background, var(--card-background-color, #fff)); z-index: 1; }
      .hm-day-label { font-size: 12px; color: var(--secondary-text-color); text-align: center; white-space: nowrap; flex-shrink: 0; }
      .led-item { display: flex; flex-direction: column; align-items: center; justify-content: center; box-sizing: border-box; flex-shrink: 0; }
      .led-indicator { border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px; transition: background-color 0.3s; text-shadow: 0 1px 2px rgba(0,0,0,0.5); box-sizing: border-box; }
      .footnote { font-size: 11px; color: var(--secondary-text-color); text-align: right; margin-top: 16px; font-style: italic; }
      .loading-box { padding: 32px; text-align: center; color: var(--secondary-text-color); font-weight: 500; }
    `;
  }

  setConfig(config) {
    const rawEntities = config.entities || [];
    const entities = rawEntities.map(e => typeof e === 'string' ? { entity: e, name: "" } : e).filter(e => e.entity && e.entity.trim() !== "");

    let rawSegments = config.segments || config.time_blocks || [
      { from: "00:00", label: "" }, { from: "04:00", label: "" }, { from: "08:00", label: "" },
      { from: "12:00", label: "" }, { from: "16:00", label: "" }, { from: "20:00", label: "" }
    ];

    // Mathematical processing of Segments
    let parsedSegments = rawSegments.map((s, index) => ({
      _id: s._id || `seg_${index}`,
      label: s.label || "",
      from: s.from || "00:00",
      startMins: parseTime(s.from || "00:00")
    }));
    
    parsedSegments.sort((a, b) => a.startMins - b.startMins);
    parsedSegments.forEach((seg, i) => {
      if (i < parsedSegments.length - 1) {
        seg.endMins = parsedSegments[i+1].startMins - 1;
      } else {
        seg.endMins = parsedSegments[0].startMins === 0 ? 1439 : parsedSegments[0].startMins - 1;
        if (parsedSegments.length === 1) seg.endMins = 1439;
      }
      if (seg.label.trim() === "") seg.displayLabel = `${formatMins(seg.startMins)} - ${formatMins(seg.endMins)}`;
      else seg.displayLabel = seg.label;
    });

    let activeStates = config.active_states || ['on', 'open', 'unlocked', 'home', 'active'];
    if (typeof activeStates === 'string') activeStates = activeStates.split(',').map(s => s.trim()).filter(s => s !== '');

    this.config = {
      ...config,
      entities: entities,
      segments: parsedSegments,
      active_states: activeStates,
      target_area: config.target_area || "",
      target_label: config.target_label || "",
      target_domain: config.target_domain || "",
      combine_entities: config.combine_entities || false,
      refresh_mode: config.refresh_mode || 'live',
      refresh_interval: config.refresh_interval || 1, 
      show_footnote: config.show_footnote !== false,
      name: config.name || "", 
      show_icon: config.show_icon !== false,
      icon: config.icon || 'mdi:view-grid',
      icon_color: config.icon_color || 'var(--success-color)',
      color_none: config.color_none || '#e5e7eb',
      color_out_of_range: config.color_out_of_range || '#9ca3af',
      thresholds: config.thresholds || [],
      days_to_show: config.days_to_show !== undefined ? config.days_to_show : 7,
      shift_overnight: config.shift_overnight !== false,
      entity_space: config.entity_space !== undefined ? config.entity_space : 24,
      time_label_width: config.time_label_width !== undefined ? config.time_label_width : 85, 
      indicator_width: config.indicator_width !== undefined ? config.indicator_width : 36,
      indicator_height: config.indicator_height !== undefined ? config.indicator_height : 36,
      indicator_gap_x: config.indicator_gap_x !== undefined ? config.indicator_gap_x : 6,
      indicator_gap_y: config.indicator_gap_y !== undefined ? config.indicator_gap_y : 6,
      show_glow: config.show_glow !== false,
      indicator_outline_width: config.indicator_outline_width !== undefined ? config.indicator_outline_width : 0,
      indicator_outline_color: config.indicator_outline_color || '#ffffff',
      show_total: config.show_total !== false
    };
    
    this.tripTimesByEntity = {};
    this._staticTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + " on " + new Date().toLocaleDateString();

    if (this.hass) this.resolveTargetEntities();
  }

  async resolveTargetEntities() {
    this._isLoading = true;
    let resolved = this.config.entities.map(e => e.entity);
    const { target_area, target_label, target_domain } = this.config;

    if (target_area || target_label || target_domain) {
      let tpl = ``;
      if (target_area) tpl += `{% set ents = area_entities('${target_area}') | default([], true) %}`;
      else if (target_label) tpl += `{% set ents = label_entities('${target_label}') | default([], true) %}`;
      else if (target_domain) tpl += `{% set ents = states['${target_domain}'] | map(attribute='entity_id') | list %}`;
      else tpl += `{% set ents = [] %}`;

      if (target_area && target_label) tpl += `{% set ents = ents | select('in', label_entities('${target_label}')) | list %}`;
      if ((target_area || target_label) && target_domain) tpl += `{% set ents = ents | select('match', '^${target_domain}\\\\.') | list %}`;
      tpl += `{{ ents | tojson }}`;

      try {
        const res = await this.hass.callApi('POST', 'template', { template: tpl });
        const autoEnts = JSON.parse(res);
        resolved = [...new Set([...resolved, ...autoEnts])];
      } catch (e) { console.error("Template resolution failed", e); }
    }
    
    this._resolvedEntities = resolved.filter(Boolean);
    this._resolvedEntities.forEach(ent => { if (!this.tripTimesByEntity[ent]) this.tripTimesByEntity[ent] = []; });
    
    this.generateRollingDays();
    await this.fetchHistory();
  }

  generateRollingDays() {
    const daysArray = [];
    const today = new Date();
    for (let i = this.config.days_to_show - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      daysArray.push({ dateString: d.toDateString(), label: d.toLocaleDateString('en-US', { weekday: 'short' }) });
    }
    this.rollingDays = daysArray;
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.config && this.config.refresh_mode === 'live') {
      const ms = Math.max(1, this.config.refresh_interval || 1) * 60000;
      this._refreshInterval = setInterval(() => { this.generateRollingDays(); this.recalculateCounts(); }, ms);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._refreshInterval) clearInterval(this._refreshInterval);
  }

  updated(changedProps) {
    super.updated(changedProps);
    if (changedProps.has('hass')) {
      const oldHass = changedProps.get('hass');
      if (!oldHass) { this.resolveTargetEntities(); return; }
      if (this.config.refresh_mode === 'static' || this._resolvedEntities.length === 0) return;

      const activeStates = this.config.active_states;
      let needsRecalc = false;

      this._resolvedEntities.forEach(entityId => {
        if (oldHass.states[entityId] && this.hass.states[entityId]) {
          const oldState = oldHass.states[entityId].state;
          const newState = this.hass.states[entityId].state;
          if (activeStates.includes(newState) && !activeStates.includes(oldState)) {
            if (!this.tripTimesByEntity[entityId]) this.tripTimesByEntity[entityId] = [];
            this.tripTimesByEntity[entityId].push(Date.now());
            needsRecalc = true;
          }
        }
      });
      if (needsRecalc) { this.generateRollingDays(); this.recalculateCounts(); }
    }
  }

  async fetchHistory() {
    if (!this.hass || this._resolvedEntities.length === 0) {
      this.recalculateCounts();
      this._isLoading = false;
      return;
    }

    const startTime = new Date(Date.now() - (this.config.days_to_show * 24 * 60 * 60 * 1000)).toISOString();
    const endTime = new Date().toISOString();
    const activeStates = this.config.active_states;
    const entityString = this._resolvedEntities.join(',');

    try {
      const response = await this.hass.callApi('GET', `history/period/${startTime}?filter_entity_id=${entityString}&end_time=${endTime}`);
      const historyArrays = response || [];

      historyArrays.forEach(history => {
        if (history.length > 0) {
          const entityId = history[0].entity_id;
          if (this.tripTimesByEntity[entityId] !== undefined) {
            const newTimestamps = [];
            for (let i = 1; i < history.length; i++) {
              if (activeStates.includes(history[i].state) && !activeStates.includes(history[i - 1].state)) {
                newTimestamps.push(new Date(history[i].last_changed).getTime());
              }
            }
            const combined = [...new Set([...this.tripTimesByEntity[entityId], ...newTimestamps])];
            this.tripTimesByEntity[entityId] = combined.sort((a, b) => a - b);
          }
        }
      });
    } catch (err) { console.error('Error fetching history:', err); }
    
    this.recalculateCounts();
    this._isLoading = false;
  }

  recalculateCounts() {
    const cutoffTime = Date.now() - (this.config.days_to_show * 24 * 60 * 60 * 1000); 
    const rows = [];

    if (this._resolvedEntities.length === 0) {
      this._renderRows = [];
      return;
    }

    if (this.config.combine_entities) {
      const grid = Array.from({ length: this.config.days_to_show }, () => {
        const dayCounts = {};
        this.config.segments.forEach(b => dayCounts[b._id] = 0);
        return dayCounts;
      });
      let masterList = [];
      this._resolvedEntities.forEach(ent => masterList.push(...(this.tripTimesByEntity[ent] || [])));
      masterList = masterList.filter(time => time >= cutoffTime);

      masterList.forEach(eventTime => {
        const eventDate = new Date(eventTime);
        const eventMinutes = eventDate.getHours() * 60 + eventDate.getMinutes();

        const blockMatch = this.config.segments.find(b => {
          if (b.startMins <= b.endMins) return eventMinutes >= b.startMins && eventMinutes <= b.endMins;
          else return eventMinutes >= b.startMins || eventMinutes <= b.endMins;
        });

        if (blockMatch) {
          let targetDate = new Date(eventTime);
          if (blockMatch.startMins > blockMatch.endMins && this.config.shift_overnight && eventMinutes <= blockMatch.endMins) {
            targetDate = new Date(targetDate.getTime() - (24 * 60 * 60 * 1000));
          }
          const dayIndex = this.rollingDays.findIndex(d => d.dateString === targetDate.toDateString());
          if (dayIndex !== -1) grid[dayIndex][blockMatch._id]++;
        }
      });
      rows.push({ name: this.config.name || "Combined Target Group", grid: grid });

    } else {
      this._resolvedEntities.forEach(entityId => {
        const grid = Array.from({ length: this.config.days_to_show }, () => {
          const dayCounts = {};
          this.config.segments.forEach(b => dayCounts[b._id] = 0);
          return dayCounts;
        });
        
        if (!this.tripTimesByEntity[entityId]) this.tripTimesByEntity[entityId] = [];
        this.tripTimesByEntity[entityId] = this.tripTimesByEntity[entityId].filter(time => time >= cutoffTime);

        this.tripTimesByEntity[entityId].forEach(eventTime => {
          const eventDate = new Date(eventTime);
          const eventMinutes = eventDate.getHours() * 60 + eventDate.getMinutes();

          const blockMatch = this.config.segments.find(b => {
            if (b.startMins <= b.endMins) return eventMinutes >= b.startMins && eventMinutes <= b.endMins;
            else return eventMinutes >= b.startMins || eventMinutes <= b.endMins;
          });

          if (blockMatch) {
            let targetDate = new Date(eventTime);
            if (blockMatch.startMins > blockMatch.endMins && this.config.shift_overnight && eventMinutes <= blockMatch.endMins) {
              targetDate = new Date(targetDate.getTime() - (24 * 60 * 60 * 1000));
            }
            const dayIndex = this.rollingDays.findIndex(d => d.dateString === targetDate.toDateString());
            if (dayIndex !== -1) grid[dayIndex][blockMatch._id]++;
          }
        });

        let displayName = entityId;
        const configEnt = this.config.entities.find(e => e.entity === entityId);
        if (configEnt && configEnt.name && configEnt.name.trim() !== "") displayName = configEnt.name;
        else if (this.hass.states[entityId] && this.hass.states[entityId].attributes.friendly_name) displayName = this.hass.states[entityId].attributes.friendly_name;
        
        rows.push({ name: displayName, grid: grid });
      });
    }

    this._renderRows = rows;
  }

  getColorForTrips(trips) {
    if (trips === 0) return this.config.color_none;
    let matchedColor = null; 
    for (const t of this.config.thresholds) {
      if (trips >= (t.from || 0) && trips <= (t.to || Infinity)) { matchedColor = t.color; break; }
    }
    return matchedColor || this.config.color_out_of_range;
  }

  render() {
    if (!this.config) return html``;

    if (this._isLoading) {
      return html`<ha-card><div class="loading-box">Fetching database history...</div></ha-card>`;
    }
    if (!this._isLoading && this._renderRows.length === 0) {
      return html`<ha-card><div class="loading-box">No entities selected or matched targeting criteria.</div></ha-card>`;
    }

    const footnoteHtml = this.config.refresh_mode === 'static'
      ? html`<div class="footnote">Static Data - Effective ${this._staticTime}</div>`
      : html`<div class="footnote">Live Data - Sliding Window Refreshes every ${this.config.refresh_interval}m</div>`;

    return html`
      <ha-card>
        ${this.config.name || this.config.show_icon ? html`
          <div class="header">
            <div class="header-title">${this.config.name}</div>
            ${this.config.show_icon ? html`<ha-icon icon="${this.config.icon}" style="color: ${this.config.icon_color};"></ha-icon>` : ''}
          </div>
        ` : ''}
        
        <div class="entities-container" style="gap: ${this.config.entity_space}px;">
          ${this._renderRows.map(row => {
            return html`
              <div class="entity-wrapper">
                <div class="entity-name">${row.name}</div>
                <div class="heatmap-table" style="gap: ${this.config.indicator_gap_y}px;">
                  <div class="hm-row" style="gap: ${this.config.indicator_gap_x}px;">
                    <div class="hm-time-label" style="width: ${this.config.time_label_width}px;"></div>
                    ${this.rollingDays.map(day => html`<div class="hm-day-label" style="width: ${this.config.indicator_width}px;">${day.label}</div>`)}
                  </div>
                  ${this.config.segments.map(block => html`
                    <div class="hm-row" style="gap: ${this.config.indicator_gap_x}px;">
                      <div class="hm-time-label" style="width: ${this.config.time_label_width}px;">${block.displayLabel}</div>
                      ${this.rollingDays.map((_, dayIndex) => {
                        const trips = row.grid[dayIndex] ? (row.grid[dayIndex][block._id] || 0) : 0;
                        const color = this.getColorForTrips(trips);
                        const glowShadow = this.config.show_glow && trips > 0 ? `, 0 0 10px color-mix(in srgb, ${color} 40%, transparent)` : '';
                        const indicatorStyles = { backgroundColor: color, width: `${this.config.indicator_width}px`, height: `${this.config.indicator_height}px`, border: `${this.config.indicator_outline_width}px solid ${this.config.indicator_outline_color}`, boxShadow: `inset 0 2px 4px rgba(0,0,0,0.1)${glowShadow}` };
                        return html`
                          <div class="led-item" style="width: ${this.config.indicator_width}px;">
                            <div class="led-indicator" style=${styleMap(indicatorStyles)}>${this.config.show_total && trips > 0 ? trips : ''}</div>
                          </div>
                        `;
                      })}
                    </div>
                  `)}
                </div>
              </div>
            `;
          })}
        </div>
        ${this.config.show_footnote ? footnoteHtml : ''}
      </ha-card>
    `;
  }

  static getConfigElement() { return document.createElement("acard-heatmap-editor"); }

  static getStubConfig() {
    return {
      entities: [{ entity: "", name: "" }],
      target_domain: "", target_area: "", target_label: "", combine_entities: false,
      refresh_mode: 'live', refresh_interval: 1, show_footnote: true,
      active_states: "on, open, unlocked, home, active", name: "",
      show_icon: true, icon: "mdi:view-grid", icon_color: "var(--success-color)",
      days_to_show: 7, shift_overnight: true, entity_space: 24, time_label_width: 85,
      indicator_width: 36, indicator_height: 36, indicator_gap_x: 6, indicator_gap_y: 6,
      show_glow: true, indicator_outline_width: 0, indicator_outline_color: "#ffffff",
      color_none: "#e5e7eb", color_out_of_range: "#9ca3af", show_total: true,
      segments: [
        { from: "00:00", label: "" }, { from: "04:00", label: "" }, { from: "08:00", label: "" },
        { from: "12:00", label: "" }, { from: "16:00", label: "" }, { from: "20:00", label: "" }
      ],
      thresholds: [
        { from: 1, to: 4, color: "#a7f3d0" }, { from: 5, to: 10, color: "#eab308" }, { from: 11, to: 9999, color: "#ef4444" }
      ]
    };
  }
}

// --- VISUAL EDITOR ---
class ACardHeatmapEditor extends LitElement {
  static get properties() { return { hass: { type: Object }, _config: { type: Object }, }; }

  setConfig(config) {
    const rawEntities = config.entities || [];
    const entities = rawEntities.map(e => typeof e === 'string' ? { entity: e, name: "" } : e);
    if (entities.length === 0) entities.push({entity: "", name: ""});
    this._config = { ...config, entities: entities };
  }

  _valueChanged(ev) {
    if (!this._config || !this.hass) return;
    const target = ev.target;
    let value = ev.detail && ev.detail.value !== undefined ? ev.detail.value : target.value;
    const configKey = target.configValue || target.getAttribute('configValue');
    if (!configKey) return;
    if (target.type === "number") value = value === "" ? "" : Number(value);
    if (target.type === "checkbox") value = target.checked;
    if (this._config[configKey] === value) return;
    const newConfig = { ...this._config };
    if (value === "") delete newConfig[configKey]; else newConfig[configKey] = value;
    this._fireChange(newConfig);
  }

  _arrayItemChanged(ev, arrayName, index, key) {
    let value = ev.detail && ev.detail.value !== undefined ? ev.detail.value : ev.target.value;
    if (key !== 'label' && key !== 'color' && key !== 'entity' && key !== 'name' && key !== 'from') value = value === "" ? undefined : Number(value);
    const arr = [...(this._config[arrayName] || [])];
    arr[index] = { ...arr[index], [key]: value }; 
    this._fireChange({ ...this._config, [arrayName]: arr });
  }

  _addArrayItem(arrayName, defaultItem) {
    const arr = [...(this._config[arrayName] || [])];
    arr.push(defaultItem);
    this._fireChange({ ...this._config, [arrayName]: arr });
  }

  _removeArrayItem(arrayName, index) {
    const arr = [...(this._config[arrayName] || [])];
    arr.splice(index, 1);
    this._fireChange({ ...this._config, [arrayName]: arr });
  }

  _moveArrayItem(arrayName, index, direction) {
    const arr = [...(this._config[arrayName] || [])];
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= arr.length) return;
    [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
    this._fireChange({ ...this._config, [arrayName]: arr });
  }

  // --- NEW AUTO-GENERATORS ---
  _generateSegments() {
    const count = Number(this.shadowRoot.getElementById('gen_seg_count').value) || 4;
    const step = 1440 / count;
    const newSegments = [];
    for(let i=0; i<count; i++) {
        let mins = Math.round(i * step);
        let h = Math.floor(mins/60).toString().padStart(2,'0');
        let m = (mins%60).toString().padStart(2,'0');
        newSegments.push({ from: `${h}:${m}`, label: "" });
    }
    this._fireChange({ ...this._config, segments: newSegments });
  }

  _generateThresholds() {
    const steps = Number(this.shadowRoot.getElementById('gen_th_steps').value) || 5;
    const min = Number(this.shadowRoot.getElementById('gen_th_min').value) || 1;
    const max = Number(this.shadowRoot.getElementById('gen_th_max').value) || 50;
    const c1 = hexToRgb(this.shadowRoot.getElementById('gen_th_c1').value || "#00ff00");
    const c2 = hexToRgb(this.shadowRoot.getElementById('gen_th_c2').value || "#ff0000");
    const newThresh = [];
    const valStep = (max - min) / Math.max(1, steps - 1);
    for(let i=0; i<steps; i++) {
        const val = Math.round(min + (i * valStep));
        const factor = steps <= 1 ? 0 : i / (steps - 1);
        const rgb = interpolateColor(c1, c2, factor);
        const hex = rgbToHex(rgb[0], rgb[1], rgb[2]);
        newThresh.push({ from: val, to: i === steps-1 ? 9999 : Math.round(min + ((i+1)*valStep)) - 1, color: hex });
    }
    this._fireChange({ ...this._config, thresholds: newThresh });
  }

  _fireChange(newConfig) {
    this._config = newConfig;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: newConfig }, bubbles: true, composed: true }));
  }

  render() {
    if (!this._config || !this.hass) return html``;
    const entities = this._config.entities || [];
    const thresholds = this._config.thresholds || [];
    const segments = this._config.segments || this._config.time_blocks || [];
    const systemSensors = this.hass ? Object.keys(this.hass.states) : [];

    let activeStatesVal = this._config.active_states;
    if (Array.isArray(activeStatesVal)) activeStatesVal = activeStatesVal.join(', ');
    else if (!activeStatesVal) activeStatesVal = 'on, open, unlocked, home, active';

    return html`
      <div class="card-config" style="display: flex; flex-direction: column; gap: 16px; margin-top: 16px;">
        
        <div style="font-weight: 500; border-bottom: 1px solid var(--divider-color); padding-bottom: 4px;">Header Options</div>
        <ha-textfield label="Card Title" .value=${this._config.name || ""} configValue="name" @input=${this._valueChanged}></ha-textfield>
        <div style="display: flex; align-items: center; gap: 12px; margin-top: 4px;">
          <input type="checkbox" id="show_icon" .checked=${this._config.show_icon !== false} configValue="show_icon" @change=${this._valueChanged} style="width: 18px; height: 18px;">
          <label for="show_icon">Show Header Icon</label>
        </div>
        ${this._config.show_icon !== false ? html`
        <div style="display: flex; gap: 8px;">
          <ha-textfield label="Icon (e.g., mdi:view-grid)" .value=${this._config.icon || "mdi:view-grid"} configValue="icon" @input=${this._valueChanged} style="flex: 1;"></ha-textfield>
          <ha-textfield label="Icon Color" .value=${this._config.icon_color || "var(--success-color)"} configValue="icon_color" @input=${this._valueChanged} style="flex: 1;"></ha-textfield>
        </div>` : ''}

        <datalist id="sensor-autocomplete-list">
          ${systemSensors.map(eid => html`<option value=${eid}>${this.hass.states[eid].attributes.friendly_name || eid}</option>`)}
        </datalist>

        <div style="font-weight: 500; border-bottom: 1px solid var(--divider-color); padding-bottom: 4px; margin-top: 8px;">Data Targeting (Dynamic Selection)</div>
        <div style="display: flex; gap: 8px;">
          <ha-textfield label="Target Area" .value=${this._config.target_area || ""} configValue="target_area" @input=${this._valueChanged} style="flex: 1;"></ha-textfield>
          <ha-textfield label="Target Label" .value=${this._config.target_label || ""} configValue="target_label" @input=${this._valueChanged} style="flex: 1;"></ha-textfield>
        </div>
        <ha-textfield label="Target Domain" .value=${this._config.target_domain || ""} configValue="target_domain" @input=${this._valueChanged} style="width: 100%;"></ha-textfield>
        
        <div style="font-weight: 500; margin-top: 8px;">Manual Entity Selection</div>
        ${entities.map((entObj, index) => html`
          <div style="display: flex; gap: 8px; align-items: flex-end; border-left: 3px solid var(--primary-color); padding-left: 12px; margin-bottom: 8px;">
            <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 4px;">
              <input list="sensor-autocomplete-list" .value=${entObj.entity || ""} @input=${(ev) => this._arrayItemChanged(ev, 'entities', index, 'entity')} style="width: 100%; padding: 10px; border: 1px solid var(--divider-color); border-radius: 4px; background: transparent; color: var(--primary-text-color); font-family: inherit; font-size: 14px;" placeholder="Entity ID..."/>
            </div>
            <ha-textfield label="Name" .value=${entObj.name || ""} @input=${(ev) => this._arrayItemChanged(ev, 'entities', index, 'name')} style="width: 30%;"></ha-textfield>
            <button @click=${() => this._removeArrayItem('entities', index)} style="background: none; border: 1px solid var(--error-color); color: var(--error-color); border-radius: 4px; padding: 10px 12px; cursor: pointer;">X</button>
          </div>
        `)}
        <button @click=${() => this._addArrayItem('entities', {entity: "", name: ""})} style="background: transparent; border: 1px dashed var(--primary-color); color: var(--primary-color); border-radius: 4px; padding: 8px; cursor: pointer;">+ Add Manual Entity</button>

        <ha-textfield label="Active States (comma-separated)" .value=${activeStatesVal} configValue="active_states" @input=${this._valueChanged} style="margin-top: 8px;"></ha-textfield>

        <div style="font-weight: 500; border-bottom: 1px solid var(--divider-color); padding-bottom: 4px; margin-top: 8px;">Server Load & Behavior</div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 12px; margin-top: 4px;">
            <input type="checkbox" id="combine_entities" .checked=${this._config.combine_entities !== false} configValue="combine_entities" @change=${this._valueChanged} style="width: 18px; height: 18px;">
            <label for="combine_entities">Combine all targeted entities into a single total row</label>
          </div>
          <select .value=${this._config.refresh_mode || 'live'} configValue="refresh_mode" @change=${this._valueChanged} style="padding: 10px; border-radius: 4px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color);">
            <option value="live">Live (Listens to WebSocket seamlessly)</option>
            <option value="static">Static (Freezes UI at moment of page load)</option>
          </select>
          ${this._config.refresh_mode === 'live' ? html`<ha-textfield label="UI Slide Interval (Minutes)" type="number" .value=${this._config.refresh_interval || 1} configValue="refresh_interval" @input=${this._valueChanged}></ha-textfield>` : ''}
          <div style="display: flex; align-items: center; gap: 12px;">
            <input type="checkbox" id="show_footnote" .checked=${this._config.show_footnote !== false} configValue="show_footnote" @change=${this._valueChanged} style="width: 18px; height: 18px;">
            <label for="show_footnote">Show Status Footnote at bottom</label>
          </div>
        </div>

        <div style="font-weight: 500; border-bottom: 1px solid var(--divider-color); padding-bottom: 4px; margin-top: 8px;">Grid Layout & Sizing</div>
        <div style="display: flex; gap: 8px;">
            <ha-textfield label="Days to Show" type="number" .value=${this._config.days_to_show !== undefined ? this._config.days_to_show : 7} configValue="days_to_show" @input=${this._valueChanged} style="flex: 1;"></ha-textfield>
        </div>
        <div style="display: flex; align-items: center; gap: 12px; margin-top: 4px; margin-bottom: 8px;">
          <input type="checkbox" id="shift_overnight" .checked=${this._config.shift_overnight !== false} configValue="shift_overnight" @change=${this._valueChanged} style="width: 18px; height: 18px;">
          <label for="shift_overnight">Shift post-midnight events back to start day</label>
        </div>
        <div style="display: flex; align-items: center; gap: 24px; margin-top: 4px; margin-bottom: 8px;">
            <label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="show_total" .checked=${this._config.show_total !== false} configValue="show_total" @change=${this._valueChanged} style="width:16px; height:16px;"> Show Numbers inside boxes</label>
            <label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="show_glow" .checked=${this._config.show_glow !== false} configValue="show_glow" @change=${this._valueChanged} style="width:16px; height:16px;"> Show Color Glow</label>
        </div>
        <div style="display: flex; gap: 8px;">
            <ha-textfield label="Row Gap (px)" type="number" .value=${this._config.entity_space !== undefined ? this._config.entity_space : 24} configValue="entity_space" @input=${this._valueChanged} style="flex: 1;"></ha-textfield>
            <ha-textfield label="Time Label W (px)" type="number" .value=${this._config.time_label_width !== undefined ? this._config.time_label_width : 85} configValue="time_label_width" @input=${this._valueChanged} style="flex: 1;"></ha-textfield>
        </div>
        <div style="display: flex; gap: 8px;">
          <ha-textfield label="Box Width (px)" type="number" .value=${this._config.indicator_width !== undefined ? this._config.indicator_width : 36} configValue="indicator_width" @input=${this._valueChanged} style="flex: 1;"></ha-textfield>
          <ha-textfield label="Box Height (px)" type="number" .value=${this._config.indicator_height !== undefined ? this._config.indicator_height : 36} configValue="indicator_height" @input=${this._valueChanged} style="flex: 1;"></ha-textfield>
        </div>
        <div style="display: flex; gap: 8px;">
          <ha-textfield label="Gap X (px)" type="number" .value=${this._config.indicator_gap_x !== undefined ? this._config.indicator_gap_x : 6} configValue="indicator_gap_x" @input=${this._valueChanged} style="flex: 1;"></ha-textfield>
          <ha-textfield label="Gap Y (px)" type="number" .value=${this._config.indicator_gap_y !== undefined ? this._config.indicator_gap_y : 6} configValue="indicator_gap_y" @input=${this._valueChanged} style="flex: 1;"></ha-textfield>
        </div>
        <div style="display: flex; gap: 8px; margin-top: 8px;">
          <ha-textfield label="Outline Width" type="number" .value=${this._config.indicator_outline_width !== undefined ? this._config.indicator_outline_width : 0} configValue="indicator_outline_width" @input=${this._valueChanged} style="flex: 1;"></ha-textfield>
          <ha-textfield label="Outline Color" .value=${this._config.indicator_outline_color || ""} configValue="indicator_outline_color" @input=${this._valueChanged} style="flex: 1;"></ha-textfield>
        </div>

        <div style="font-weight: 500; border-bottom: 1px solid var(--divider-color); padding-bottom: 4px; margin-top: 16px;">Time Segments (Y-Axis)</div>
        <div style="background: var(--secondary-background-color); padding: 12px; border-radius: 4px; margin-bottom: 8px;">
            <div style="font-weight:bold; font-size:12px; margin-bottom:8px;">Auto-Generate Segments</div>
            <div style="display:flex; gap:8px; align-items:center;">
                <ha-textfield id="gen_seg_count" label="Num Segments" type="number" value="4" style="flex:1;"></ha-textfield>
                <button @click=${this._generateSegments} style="background: var(--primary-color); color: var(--text-primary-color); border:none; padding:10px 16px; border-radius:4px; cursor:pointer;">Generate</button>
            </div>
        </div>

        <div style="font-size: 12px; color: var(--secondary-text-color); margin-bottom: 8px;">Leave Label blank to auto-generate based on 'From' time.</div>
        ${segments.map((b, index) => html`
          <div style="display: flex; gap: 8px; align-items: center; border-left: 3px solid #8b5cf6; padding-left: 12px; margin-bottom: 4px;">
            <div style="display: flex; flex-direction: column; gap: 2px;">
                <button @click=${() => this._moveArrayItem('segments', index, -1)} style="background: none; border: 1px solid var(--primary-text-color); border-radius: 4px; padding: 4px; cursor: pointer; font-size: 10px;">▲</button>
                <button @click=${() => this._moveArrayItem('segments', index, 1)} style="background: none; border: 1px solid var(--primary-text-color); border-radius: 4px; padding: 4px; cursor: pointer; font-size: 10px;">▼</button>
            </div>
            <ha-textfield label="From (HH:MM)" .value=${b.from || ""} @input=${(ev) => this._arrayItemChanged(ev, 'segments', index, 'from')} style="width: 40%;"></ha-textfield>
            <ha-textfield label="Override Label" .value=${b.label || ""} @input=${(ev) => this._arrayItemChanged(ev, 'segments', index, 'label')} style="width: 60%;"></ha-textfield>
            <button @click=${() => this._removeArrayItem('segments', index)} style="background: none; border: 1px solid var(--error-color); color: var(--error-color); border-radius: 4px; padding: 12px; cursor: pointer;">X</button>
          </div>
        `)}
        <button @click=${() => this._addArrayItem('segments', {from: "00:00", label: ""})} style="background: transparent; border: 1px dashed #8b5cf6; color: #8b5cf6; border-radius: 4px; padding: 8px; cursor: pointer;">+ Add Segment</button>

        <div style="font-weight: 500; border-bottom: 1px solid var(--divider-color); padding-bottom: 4px; margin-top: 16px;">Color Thresholds</div>
        <div style="display: flex; gap: 8px; margin-bottom: 12px;">
          <ha-textfield label="Zero Value Color" .value=${this._config.color_none || "#e5e7eb"} configValue="color_none" @input=${this._valueChanged} style="flex:1;"></ha-textfield>
          <ha-textfield label="Out of Range Color" .value=${this._config.color_out_of_range || "#9ca3af"} configValue="color_out_of_range" @input=${this._valueChanged} style="flex:1;" title="Used if value doesn't hit any threshold"></ha-textfield>
        </div>

        <div style="background: var(--secondary-background-color); padding: 12px; border-radius: 4px; margin-bottom: 8px;">
            <div style="font-weight:bold; font-size:12px; margin-bottom:8px;">Auto-Generate Gradient Thresholds</div>
            <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
                <ha-textfield id="gen_th_min" label="Min Val" type="number" value="1" style="flex:1;"></ha-textfield>
                <ha-textfield id="gen_th_max" label="Max Val" type="number" value="20" style="flex:1;"></ha-textfield>
                <ha-textfield id="gen_th_steps" label="Steps" type="number" value="5" style="flex:1;"></ha-textfield>
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
                <ha-textfield id="gen_th_c1" label="Start Color Hex" value="#a7f3d0" style="flex:1;"></ha-textfield>
                <ha-textfield id="gen_th_c2" label="End Color Hex" value="#ef4444" style="flex:1;"></ha-textfield>
                <button @click=${this._generateThresholds} style="background: var(--primary-color); color: var(--text-primary-color); border:none; padding:10px 16px; border-radius:4px; cursor:pointer;">Generate</button>
            </div>
        </div>

        ${thresholds.map((t, index) => html`
          <div style="display: flex; gap: 8px; align-items: center; border-left: 3px solid var(--primary-color); padding-left: 12px; margin-bottom:4px;">
            <ha-textfield label="From" type="number" .value=${t.from !== undefined ? t.from : ""} @input=${(ev) => this._arrayItemChanged(ev, 'thresholds', index, 'from')} style="width: 70px;"></ha-textfield>
            <ha-textfield label="To" type="number" .value=${t.to !== undefined ? t.to : ""} @input=${(ev) => this._arrayItemChanged(ev, 'thresholds', index, 'to')} style="width: 70px;"></ha-textfield>
            <ha-textfield label="Color" .value=${t.color || ""} @input=${(ev) => this._arrayItemChanged(ev, 'thresholds', index, 'color')} style="flex-grow: 1;"></ha-textfield>
            <button @click=${() => this._removeArrayItem('thresholds', index)} style="background: none; border: 1px solid var(--error-color); color: var(--error-color); border-radius: 4px; padding: 12px; cursor: pointer;">X</button>
          </div>
        `)}
        <button @click=${() => this._addArrayItem('thresholds', {from: 0, to: 10, color: '#3b82f6'})} style="background: transparent; border: 1px dashed var(--primary-color); color: var(--primary-color); border-radius: 4px; padding: 8px; cursor: pointer;">+ Add Threshold</button>

      </div>
    `;
  }
}

customElements.define('acard-heatmap', ACardHeatmap);
customElements.define('acard-heatmap-editor', ACardHeatmapEditor);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "acard-heatmap",
  name: "aCard Heatmap",
  preview: true,
  description: "A highly customizable 2D grid showing historical events with automated generators."
});