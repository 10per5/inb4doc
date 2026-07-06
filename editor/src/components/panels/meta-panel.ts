import { githubIconStr } from "@/components/ui/icons";

export interface MetaPanelData {
  title: string;
  weight?: number;
  [key: string]: string | number | undefined;
}

export interface MetaPanelAPI {
  update(data: MetaPanelData): void;
  getData(): MetaPanelData;
}

export function mountMetaPanel(
  container: HTMLElement,
  onChange: (data: MetaPanelData) => void,
): MetaPanelAPI {
  let currentData: MetaPanelData = { title: "" };

  container.innerHTML = `
    <div class="meta-panel-wrapper">
      <div class="meta-panel">
        <div class="meta-panel-header">Page Metadata</div>
        <div class="meta-field">
          <label>Title</label>
          <input type="text" class="meta-title" />
        </div>
        <div class="meta-field">
          <label>Weight</label>
          <input type="number" class="meta-weight" />
        </div>
        <div class="meta-extra-header">Extra Fields</div>
        <div class="meta-extra"></div>
      </div>
      <div class="meta-panel-footer">
        <a href="https://github.com/10per5/inb4doc" target="_blank" rel="noopener noreferrer" class="github-link">
          ${githubIconStr}
          <span>View on GitHub</span>
        </a>
      </div>
    </div>
  `;

  const titleInput = container.querySelector(".meta-title") as HTMLInputElement;
  const weightInput = container.querySelector(
    ".meta-weight",
  ) as HTMLInputElement;
  const extraContainer = container.querySelector(".meta-extra") as HTMLElement;
  const addBtn = document.createElement("button");
  addBtn.className = "meta-extra-add";
  addBtn.textContent = "+ Add Field";
  addBtn.addEventListener("click", () => {
    const row = document.createElement("div");
    row.className = "meta-extra-row";
    row.innerHTML = `
      <input class="meta-extra-key" placeholder="key" />
      <input class="meta-extra-val" placeholder="value" />
      <button class="meta-extra-remove">×</button>
    `;
    row.querySelector(".meta-extra-remove")!.addEventListener("click", () => {
      row.remove();
      notify();
    });
    (row.querySelector(".meta-extra-key") as HTMLInputElement).addEventListener(
      "input",
      notify,
    );
    (row.querySelector(".meta-extra-val") as HTMLInputElement).addEventListener(
      "input",
      notify,
    );
    extraContainer.appendChild(row);
    row.querySelector("input")!.focus();
  });
  container.querySelector(".meta-panel")!.appendChild(addBtn);

  function notify() {
    const data = getData();
    onChange(data);
  }

  function getData(): MetaPanelData {
    const data: MetaPanelData = { title: titleInput.value };
    const w = parseInt(weightInput.value);
    if (!isNaN(w)) data.weight = w;

    extraContainer.querySelectorAll(".meta-extra-row").forEach((row) => {
      const keyInput = row.querySelector(".meta-extra-key") as HTMLInputElement;
      const valInput = row.querySelector(".meta-extra-val") as HTMLInputElement;
      if (keyInput.value) data[keyInput.value] = valInput.value;
    });

    return data;
  }

  function renderExtra(extra: Record<string, string>) {
    extraContainer.innerHTML = "";
    for (const [key, val] of Object.entries(extra)) {
      const row = document.createElement("div");
      row.className = "meta-extra-row";
      row.innerHTML = `
        <input class="meta-extra-key" value="${key}" placeholder="key" />
        <input class="meta-extra-val" value="${val}" placeholder="value" />
        <button class="meta-extra-remove">×</button>
      `;
      row.querySelector(".meta-extra-remove")!.addEventListener("click", () => {
        row.remove();
        notify();
      });
      (
        row.querySelector(".meta-extra-key") as HTMLInputElement
      ).addEventListener("input", notify);
      (
        row.querySelector(".meta-extra-val") as HTMLInputElement
      ).addEventListener("input", notify);
      extraContainer.appendChild(row);
    }
  }

  titleInput.addEventListener("input", notify);
  weightInput.addEventListener("input", notify);

  return {
    update(data: MetaPanelData) {
      currentData = data;
      titleInput.value = data.title || "";
      weightInput.value = data.weight != null ? String(data.weight) : "";

      const extras: Record<string, string> = {};
      for (const [key, val] of Object.entries(data)) {
        if (key !== "title" && key !== "weight" && val !== undefined) {
          extras[key] = String(val);
        }
      }
      renderExtra(extras);
    },
    getData,
  };
}
