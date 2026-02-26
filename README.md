# aCard Heatmap for Home Assistant

A highly customizable, highly optimized 2D grid card for Home Assistant that visualizes historical event frequencies over a rolling multi-day period. Perfect for tracking motion sensors, door/window covers, presence detection, or any state changes mapped across specific times of day.

I have made a series of aCards for my own home assistant setup. These were all coded with the help of Gemini and Claude AI.

## ✨ Features

* **Zero Ongoing Database Load:** Queries the Home Assistant database exactly *once* on load, then seamlessly updates via the live WebSocket stream.
* **Dynamic Data Targeting:** Automatically pull in entities by Area, Label, or Domain (e.g., "Show me every cover in the Den labeled 'important'").
* **Entity Aggregation:** Option to merge all selected/targeted entities into a single, combined row (e.g., "Total Opens of All Doors").
* **Smart Auto-Generators:** * Auto-slice your day into evenly spaced time segments.
  * Auto-generate beautiful gradient color thresholds between a start and end color.
* **Fully Configurable UI:** 100% supported by the Home Assistant Visual Editor. No YAML required.
* **Smart Overnight Shifting:** Option to visually group late-night/early-morning events (e.g., 2 AM) back to the starting calendar day for intuitive "night shift" tracking.

## 📥 Installation

### Option 1: HACS (Recommended)
*Note: Ensure you have [HACS](https://hacs.xyz/) installed.*

1. Go to HACS -> Frontend.
2. Click the 3 dots in the top right and select **Custom repositories**.
3. Paste the URL to this repository and select **Dashboard** as the category.
4. Click **Add**, then find **aCard Heatmap** in HACS and click **Download**.
5. Refresh your browser.

### Option 2: Manual
1. Download the `acard-heatmap.js` file from the latest release.
2. Copy the file into your Home Assistant `<config>/www/` directory.
3. Go to **Settings** -> **Dashboards** -> **3 dots (top right)** -> **Resources**.
4. Add a new resource:
   * **URL:** `/local/acard-heatmap.js?v=1`
   * **Resource Type:** JavaScript Module
5. Hard refresh your browser.

## 🛠️ Configuration

The card is fully configurable via the Visual Editor in Home Assistant. Simply add a new card and search for `"aCard Heatmap"`.

### Advanced: Dynamic Targeting
Instead of manually typing out entity IDs, you can use the **Data Targeting** fields in the Visual Editor:

* **Target Area:** e.g., `living_room`
* **Target Label:** e.g., `security`
* **Target Domain:** e.g., `binary_sensor`

If you use multiple targeting fields, the card will strictly intersect them (e.g., finding only `binary_sensors` that are *also* in the `living_room` *and* labeled `security`).

### Configuration Variables

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `type` | string | **Required** | Must be `custom:acard-heatmap`. |
| `entities` | list | `[]` | List of manual entity objects (containing `entity` and optional `name`). *Required if not using target fields.* |
| `target_area` | string | `""` | Dynamically pull all entities from a specific Home Assistant Area. |
| `target_label` | string | `""` | Dynamically pull all entities with a specific Home Assistant Label. |
| `target_domain` | string | `""` | Dynamically pull all entities of a specific domain (e.g., `cover`). |
| `combine_entities`| boolean | `false` | Merges all targeted/manual entities into one master aggregated row. |
| `active_states` | string/list | `on, open, unlocked, home, active` | Comma-separated list of states that trigger a "trip" (e.g., `playing`, `cleaning`). |
| `refresh_mode` | string | `live` | Options: `live` (WebSocket updates) or `static` (frozen at page load). |
| `refresh_interval`| number | `1` | How often (in minutes) the UI slides the time window forward in `live` mode. |
| `days_to_show` | number | `7` | How many days of history to retrieve from the database. |
| `shift_overnight` | boolean | `true` | If true, late-night events shift back to the calendar day the segment started on. |
| `segments` | list | *(6 defaults)* | List of time blocks defined by a `from` time (e.g., `00:00`) and an optional `label`. |
| `thresholds` | list | *(3 defaults)* | Color mapping objects defined by `from`, `to`, and `color`. |
| `name` | string | `""` | The title displayed at the top of the card. |
| `show_icon` | boolean | `true` | Whether to show the header icon. |
| `icon` | string | `mdi:view-grid` | The Material Design icon to show in the header. |
| `icon_color` | string | `var(--success-color)`| Color of the header icon. |
| `color_none` | string | `#e5e7eb` | Background color for segments with 0 trips. |
| `color_out_of_range`| string | `#9ca3af` | Color used if a trip count falls outside all defined thresholds. |
| `show_total` | boolean | `true` | Displays the numeric count of trips inside the segment box. |
| `show_glow` | boolean | `true` | Adds a semi-transparent colored drop-shadow to active indicators. |
| `show_footnote` | boolean | `true` | Displays the Live/Static status indicator at the bottom of the card. |
| `indicator_width` | number | `36` | The width (in pixels) of the individual segment boxes. |
| `indicator_height`| number | `36` | The height (in pixels) of the individual segment boxes. |
| `indicator_gap_x` | number | `6` | Horizontal gap spacing (in pixels) between segment boxes. |
| `indicator_gap_y` | number | `6` | Vertical gap spacing (in pixels) between segment rows. |
| `entity_space` | number | `24` | Vertical space (in pixels) separating entirely different entities. |
| `time_label_width`| number | `85` | Width (in pixels) reserved for the Y-Axis time segment labels. |
| `indicator_outline_width`| number | `0` | Border width around the individual segment boxes. |
| `indicator_outline_color`| string | `#ffffff` | Color of the border outline. |

### YAML Example
If you prefer YAML, here is a basic configuration:

```yaml
type: custom:acard-heatmap
name: Living Room Motion
icon: mdi:run
entities:
  - entity: binary_sensor.living_room_motion
    name: Main Sensor
days_to_show: 7
refresh_mode: live
segments:
  - from: '00:00'
  - from: '06:00'
  - from: '12:00'
  - from: '18:00'
thresholds:
  - from: 1
    to: 5
    color: '#a7f3d0'
  - from: 6
    to: 15
    color: '#34d399'
  - from: 16
    to: 9999
    color: '#ef4444'
```
## ⚙️ How "Live" vs "Static" Modes Work

In the visual editor, you can choose how the card behaves under **Server Load & Behavior**:

* **Live (Default):** The card loads historical data once, then uses Home Assistant's built-in WebSocket to listen for live state changes, adding them to the heatmap in real-time. It runs a lightweight local timer to slide the time window forward.
* **Static:** The card takes a snapshot of your database exactly when the dashboard loads and freezes the UI. Best for performance-constrained devices viewing massive datasets.

## 🐛 Troubleshooting

* **Card isn't showing up in the picker:** Ensure you have added the resource in your dashboard settings and performed a hard refresh (`Ctrl+F5` or `Cmd+Shift+R`).
* **Alignment issues on mobile:** Ensure `Auto-Scale Width` is unchecked if you want rigid box sizes, and the card will automatically allow horizontal scrolling.
