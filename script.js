const API_BASE_URL = "https://api-ems-bic.quangtriet430.workers.dev";
let currentUser = null;
let globalStages = [];
let currentMatrixData = null;
let leaderPOsCache = [];
let productsCache = [];
let adminPollingInterval = null;
let leaderPollingInterval = null;
let tempUserForPassChange = null;
let lastPendingDataString = ""; // Dùng cho Leader để tránh load lại nhấp nháy

// ==========================================
// 1. XỬ LÝ ĐĂNG NHẬP, ĐIỀU HƯỚNG
// ==========================================
window.addEventListener("DOMContentLoaded", () => {
  setDefaultDates();
  const savedUser = localStorage.getItem("ems_user");
  if (savedUser) {
    currentUser = JSON.parse(savedUser);
    navigateToRoleScreen();
  }
});

document
  .getElementById("login-form")
  .addEventListener("submit", async function (e) {
    e.preventDefault();
    const usernameInput = document.getElementById("username").value.trim();
    const passwordInput = document.getElementById("password").value;
    const errorMsg = document.getElementById("login-error");

    try {
      errorMsg.classList.add("hidden");
      const response = await fetch(`${API_BASE_URL}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: usernameInput,
          password: passwordInput,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        errorMsg.textContent = data.error || "Lỗi đăng nhập!";
        errorMsg.classList.remove("hidden");
        return;
      }

      // Đổi pass nếu pass là 000
      if (data.user.password_hash === "000") {
        tempUserForPassChange = data.user;
        document.getElementById("change-pass-modal").classList.remove("hidden");
        return;
      }

      currentUser = data.user;
      localStorage.setItem("ems_user", JSON.stringify(currentUser));
      navigateToRoleScreen();
    } catch (error) {
      errorMsg.textContent = "Không thể kết nối đến máy chủ API.";
      errorMsg.classList.remove("hidden");
    }
  });

window.submitNewPassword = async function () {
  const newPass = document.getElementById("new-password").value;
  if (newPass.length < 4) return alert("Mật khẩu phải từ 4 ký tự trở lên!");
  try {
    const res = await fetch(`${API_BASE_URL}/api/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: tempUserForPassChange.username,
        new_password: newPass,
      }),
    });
    if (res.ok) {
      alert("Đổi mật khẩu thành công! Chào mừng bạn.");
      document.getElementById("change-pass-modal").classList.add("hidden");
      tempUserForPassChange.password_hash = newPass;
      currentUser = tempUserForPassChange;
      localStorage.setItem("ems_user", JSON.stringify(currentUser));
      navigateToRoleScreen();
    } else {
      alert("Đã xảy ra lỗi khi lưu mật khẩu.");
    }
  } catch (e) {
    alert("Lỗi máy chủ khi đổi mật khẩu.");
  }
};

function logout() {
  currentUser = null;
  localStorage.removeItem("ems_user");
  if (adminPollingInterval) clearInterval(adminPollingInterval);
  if (leaderPollingInterval) clearInterval(leaderPollingInterval);
  document.getElementById("login-form").reset();
  document.querySelectorAll(".screen").forEach((s) => {
    s.classList.remove("active");
    s.classList.add("hidden");
  });
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("login-screen").classList.add("active");
}

function navigateToRoleScreen() {
  document.querySelectorAll(".screen").forEach((s) => {
    s.classList.remove("active");
    s.classList.add("hidden");
  });
  if (adminPollingInterval) clearInterval(adminPollingInterval);
  if (leaderPollingInterval) clearInterval(leaderPollingInterval);

  const displayName = currentUser.full_name || currentUser.username;

  if (currentUser.role === "ADMIN") {
    document.getElementById("admin-screen").classList.remove("hidden");
    document.getElementById("admin-screen").classList.add("active");
    document.getElementById("admin-name").textContent = displayName;

    loadNGDropdownsThorough().then(() => {
      fetchProductsList();
    });

    switchTab("admin", "tab-matrix");
    adminPollingInterval = setInterval(fetchMatrixReport, 5000);
  } else if (currentUser.role === "LEADER") {
    document.getElementById("leader-screen").classList.remove("hidden");
    document.getElementById("leader-screen").classList.add("active");
    document.getElementById("leader-name").textContent = displayName;

    loadNGDropdownsThorough().then(() => {
      const myStages = globalStages.filter(
        (s) => s.line_id === currentUser.line_id,
      );
      if (myStages.length > 0) {
        document.getElementById("leader-line").textContent = myStages
          .map((s) => s.stage_name)
          .join(", ");
      } else {
        document.getElementById("leader-line").textContent =
          currentUser.line_id;
      }
      switchTab("leader", "tab-wip");
      fetchPendingPOs();
    });

    if (currentUser.line_id === "ASSY") {
      document.getElementById("btn-outsource")?.classList.remove("hidden");
    }

    leaderPollingInterval = setInterval(fetchPendingPOs, 5000);
  }
}

function switchTab(role, tabId) {
  let container =
    role === "admin"
      ? document.getElementById("admin-screen")
      : document.getElementById("leader-screen");
  let btnClass =
    role === "admin" ? ".sidebar .tab-btn" : ".tabs-mobile .tab-btn-mobile";
  let tabClass =
    role === "admin"
      ? ".app-body .tab-content"
      : ".content-mobile .tab-content";

  container.querySelectorAll(tabClass).forEach((tab) => {
    tab.classList.remove("active");
    tab.classList.add("hidden");
  });
  container.querySelectorAll(btnClass).forEach((btn) => {
    btn.classList.remove("active");
  });

  document.getElementById(tabId).classList.remove("hidden");
  document.getElementById(tabId).classList.add("active");
  if (window.event && window.event.currentTarget)
    window.event.currentTarget.classList.add("active");

  if (role === "admin" && tabId === "tab-matrix") fetchMatrixReport();
  if (role === "admin" && tabId === "tab-history") fetchHistoryLog();
  if (role === "leader" && tabId === "tab-history-leader") fetchHistoryLog();
}

// ==========================================
// 2. ADMIN: TẠO MÃ, PO, MATRIX, HISTORY
// ==========================================
async function loadNGDropdownsThorough() {
  const fallbackStages = [{ id: "CAT", stage_name: "Cắt" }];
  try {
    const stageRes = await fetch(`${API_BASE_URL}/api/stages`);
    const stageData = await stageRes.json();
    globalStages =
      stageData.data && stageData.data.length > 0
        ? stageData.data
        : fallbackStages;
  } catch (e) {
    globalStages = fallbackStages;
  }

  let stageOpts = '<option value="">-- Chọn công đoạn --</option>';
  globalStages.forEach((col) => {
    stageOpts += `<option value="${col.id}">${col.stage_name}</option>`;
  });
  if (document.getElementById("ng-current-stage"))
    document.getElementById("ng-current-stage").innerHTML = stageOpts;
  if (document.getElementById("ng-return-stage"))
    document.getElementById("ng-return-stage").innerHTML = stageOpts;

  try {
    const ngRes = await fetch(`${API_BASE_URL}/api/ng/list`);
    const ngData = await ngRes.json();
    const poSelect = document.getElementById("ng-po-select");
    if (poSelect) {
      let poOpts = '<option value="">-- Chọn Lô / PO --</option>';
      if (ngData.data && ngData.data.length > 0) {
        ngData.data.forEach((po) => {
          poOpts += `<option value="${po.lot_number}">${po.lot_number} [${po.product_code}] - Lỗi: ${po.ng_qty}</option>`;
        });
      } else {
        poOpts = '<option value="">-- Hiện không có hàng NG nào --</option>';
      }
      poSelect.innerHTML = poOpts;
    }
  } catch (e) {
    console.error("Lỗi nạp danh sách NG:", e);
  }
}

let routingStepCount = 0;
window.addRoutingStep = function () {
  routingStepCount++;
  const container = document.getElementById("routing-builder");
  const stepDiv = document.createElement("div");
  stepDiv.style.display = "flex";
  stepDiv.style.gap = "10px";
  stepDiv.style.marginBottom = "10px";
  stepDiv.innerHTML = `<span style="font-weight:bold; min-width: 70px;">Bước ${routingStepCount}:</span><select class="routing-stage-select" required style="padding: 8px; flex: 1;"><option value="">-- Chọn công đoạn --</option>${globalStages.map((s) => `<option value="${s.id}">${s.stage_name}</option>`).join("")}</select><button type="button" class="btn btn-danger" onclick="this.parentElement.remove()">Xóa</button>`;
  container.appendChild(stepDiv);
};

const formCreateProduct = document.getElementById("form-create-product");
if (formCreateProduct) {
  formCreateProduct.addEventListener("submit", async function (e) {
    e.preventDefault();
    const routingMap = [];
    document.querySelectorAll(".routing-stage-select").forEach((sel, idx) => {
      if (sel.value) routingMap.push({ order: idx + 1, stage_id: sel.value });
    });
    if (routingMap.length === 0)
      return alert("Vui lòng thêm ít nhất 1 công đoạn!");
    try {
      const response = await fetch(`${API_BASE_URL}/api/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_code: document
            .getElementById("md-product-code")
            .value.trim()
            .toUpperCase(),
          product_name: document.getElementById("md-product-name").value.trim(),
          routing_map: routingMap,
        }),
      });
      if (response.ok) {
        alert("Khởi tạo mã hàng thành công!");
        formCreateProduct.reset();
        document.getElementById("routing-builder").innerHTML = "";
        routingStepCount = 0;
        fetchProductsList();
      } else {
        const d = await response.json();
        alert("Lỗi: " + d.error);
      }
    } catch (error) {
      alert("Lỗi kết nối API!");
    }
  });
}

async function fetchProductsList() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/products`);
    const data = await response.json();
    if (data.products) {
      productsCache = data.products;
      document.getElementById("product-suggestions").innerHTML = productsCache
        .map(
          (p) => `<option value="${p.product_code}">${p.product_name}</option>`,
        )
        .join("");
      renderMasterTable(productsCache);
    }
  } catch (e) {
    console.error("Lỗi:", e);
  }
}

function renderMasterTable(data) {
  const container = document.getElementById("master-list-container");
  if (!container) return;
  let html = `<table class="matrix-table" style="font-size: 13px;"><thead><tr><th>Mã Hàng</th><th>Tên</th><th>Lộ trình (Trạm)</th></tr></thead><tbody>`;
  data.forEach((p) => {
    let routingText = "";
    try {
      routingText = JSON.parse(p.routing_map)
        .map((step) => {
          const obj = globalStages.find((st) => st.id == step.stage_id);
          return obj ? obj.stage_name : step.stage_id;
        })
        .join(" ➔ ");
    } catch (e) {
      routingText = "Lỗi";
    }
    html += `<tr><td style="font-weight:bold; color:var(--navy);">${p.product_code}</td><td>${p.product_name}</td><td>${routingText}</td></tr>`;
  });
  container.innerHTML = html + `</tbody></table>`;
}

window.filterMasterData = function () {
  const val = (
    document.getElementById("search-master")?.value || ""
  ).toLowerCase();
  renderMasterTable(
    productsCache.filter(
      (p) =>
        (p.product_code || "").toLowerCase().includes(val) ||
        (p.product_name || "").toLowerCase().includes(val),
    ),
  );
};

const formCreatePO = document.getElementById("form-create-po");
if (formCreatePO) {
  formCreatePO.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!currentUser) return;

    const prefix = document
      .getElementById("po-prefix")
      .value.trim()
      .toUpperCase();
    const productCode = document
      .getElementById("product-code")
      .value.trim()
      .toUpperCase();
    const poDate = document.getElementById("po-date").value;
    const totalQty = parseInt(document.getElementById("po-total").value);
    const splitQty = parseInt(document.getElementById("po-split").value);

    if (splitQty > totalQty) {
      alert("Kích thước 1 LOT không được lớn hơn Tổng sản lượng!");
      return;
    }

    const lots = [];
    let remaining = totalQty;
    let counter = 1;

    while (remaining > 0) {
      const qtyForThisLot = remaining > splitQty ? splitQty : remaining;
      const lotNumber = `${prefix}-${String(counter).padStart(2, "0")}`;
      lots.push({ po_number: lotNumber, qty: qtyForThisLot });
      remaining -= qtyForThisLot;
      counter++;
    }

    // ĐÃ KHÔI PHỤC: Câu thông báo chi tiết số lượng từng LOT
    const confirmMsg = `Hệ thống sẽ chẻ thành ${lots.length} LOT (${lots.map((l) => l.qty).join(", ")}).\nBạn có chắc chắn?`;
    if (!confirm(confirmMsg)) return;

    let successCount = 0;
    let errorMessages = [];

    for (const lot of lots) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/po/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            po_number: lot.po_number,
            product_code: productCode,
            production_date: poDate,
            total_qty: lot.qty,
            user_id: currentUser.id,
          }),
        });
        const data = await response.json();

        if (response.ok) {
          successCount++;
        } else {
          errorMessages.push(`Lỗi LOT ${lot.po_number}: ${data.error}`);
        }
      } catch (err) {
        errorMessages.push(`Lỗi kết nối khi tạo LOT ${lot.po_number}`);
      }
    }

    // ĐÃ KHÔI PHỤC: Báo cáo thành công hoặc liệt kê danh sách lỗi
    if (errorMessages.length > 0) {
      alert(
        `Đã tạo được ${successCount}/${lots.length} LOT.\nDanh sách lỗi:\n` +
          errorMessages.join("\n"),
      );
    } else {
      alert(
        `Đã cấp phát THÀNH CÔNG ${successCount}/${lots.length} LOT vào dây chuyền!`,
      );
      formCreatePO.reset();
      setDefaultDates();
    }

    fetchMatrixReport(); // Cập nhật lại Bảng theo dõi Matrix
  });
}

async function fetchMatrixReport() {
  if (!currentUser || currentUser.role !== "ADMIN") return;
  try {
    const response = await fetch(`${API_BASE_URL}/api/dashboard/matrix`);
    const data = await response.json();
    if (!data.matrix) return;

    const columns = globalStages;
    const rows = data.matrix.map((row) => {
      const stages = {};
      columns.forEach((c) => {
        const colLower = c.id.toLowerCase();
        stages[c.id] = {
          good: row[`qty_${colLower}`] || 0,
          ng: row[`ng_${colLower}`] || 0,
          date: row[`date_${colLower}`],
        };
      });
      return {
        production_date: row.production_date,
        po_number: row.lot_number,
        product_code: row.product_code,
        total_qty: row.total_qty,
        finished_qty: row.qty_done,
        stages,
      };
    });
    currentMatrixData = { columns, rows };
    filterMatrix();
  } catch (error) {}
}

function renderMatrixTable(rows) {
  const container = document.getElementById("matrix-table-container");
  if (!currentMatrixData || !container) return;
  const lineColors = {
    CUTTING: "#ffebee",
    NC: "#e3f2fd",
    MNC: "#e8f5e9",
    GS_GV: "#fff3e0",
    GP_GE_GI: "#f3e5f5",
    ASSY: "#fffde7",
    KENSA: "#eceff1",
  };

  let tableHTML = `<table class="matrix-table" id="export-table"><thead><tr>`;
  tableHTML += `<th rowspan="2" style="vertical-align: middle;">Ngày</th><th rowspan="2" style="vertical-align: middle;">Số LOT</th><th rowspan="2" style="vertical-align: middle;">Mã Hàng</th><th rowspan="2" style="vertical-align: middle;">Tổng</th>`;

  currentMatrixData.columns.forEach((col) => {
    tableHTML += `<th colspan="2" style="background-color: ${lineColors[col.line_id] || "transparent"}; border-bottom:1px solid #ccc; text-align:center;">${col.stage_name}</th>`;
  });
  tableHTML += `<th rowspan="2" style="vertical-align: middle;">KHO</th></tr><tr>`;

  currentMatrixData.columns.forEach((col) => {
    tableHTML += `<th style="background-color: ${lineColors[col.line_id] || "transparent"}; color: #48BB78; font-size:11px;">OK</th><th style="background-color: ${lineColors[col.line_id] || "transparent"}; color: #ea580c; font-size:11px; border-right: 2px solid rgba(0,0,0,0.1);">NG</th>`;
  });
  tableHTML += `</tr></thead><tbody>`;

  if (rows.length === 0) {
    tableHTML += `<tr><td colspan="${currentMatrixData.columns.length * 2 + 5}" style="text-align: center; padding: 20px;">Không tìm thấy dữ liệu.</td></tr>`;
  }

  rows.forEach((row) => {
    tableHTML += `<tr><td>${row.production_date || "-"}</td><td style="font-weight:bold; color:var(--navy);">${row.po_number}</td><td>${row.product_code}</td><td style="font-weight:bold;">${row.total_qty}</td>`;

    currentMatrixData.columns.forEach((col) => {
      const stg = row.stages[col.id];
      let timeStr = "Chưa thao tác";
      if (stg && stg.date) {
        try {
          timeStr = new Date(stg.date.replace(" ", "T") + "Z")
            .toLocaleString("vi-VN", {
              timeZone: "Asia/Ho_Chi_Minh",
              hour12: false,
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
            .replace(",", "");
        } catch (e) {}
      }

      tableHTML +=
        stg && stg.good > 0
          ? `<td class="has-tooltip" data-time="${timeStr}" style="background-color: ${lineColors[col.line_id] || "transparent"}; text-align:center;"><span class="badge-good">${stg.good}</span></td>`
          : `<td style="background-color: ${lineColors[col.line_id] || "transparent"}; text-align:center;"><span class="cell-empty">-</span></td>`;

      tableHTML +=
        stg && stg.ng > 0
          ? `<td style="background-color: ${lineColors[col.line_id] || "transparent"}; text-align:center; border-right: 2px solid rgba(0,0,0,0.1);"><span style="background:#ea580c; color:#fff; border-radius:4px; padding: 2px 6px; font-size: 11px;">${stg.ng}</span></td>`
          : `<td style="background-color: ${lineColors[col.line_id] || "transparent"}; text-align:center; border-right: 2px solid rgba(0,0,0,0.1);"><span class="cell-empty">-</span></td>`;
    });
    tableHTML += `<td style="font-weight:bold; color:#48BB78;">${row.finished_qty > 0 ? row.finished_qty : "-"}</td></tr>`;
  });
  container.innerHTML = tableHTML + `</tbody></table>`;
}

window.filterMatrix = function () {
  if (!currentMatrixData) return;
  const dateVal = (
    document.getElementById("search-date")?.value || ""
  ).toLowerCase();
  const lotVal = (
    document.getElementById("search-lot")?.value || ""
  ).toLowerCase();
  const codeVal = (
    document.getElementById("search-code")?.value || ""
  ).toLowerCase();
  renderMatrixTable(
    currentMatrixData.rows.filter(
      (r) =>
        (r.production_date || "").toLowerCase().includes(dateVal) &&
        (r.po_number || "").toLowerCase().includes(lotVal) &&
        (r.product_code || "").toLowerCase().includes(codeVal),
    ),
  );
};

let historyLogCache = [];

async function fetchHistoryLog() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/history`);
    const result = await res.json();

    if (result.data) {
      historyLogCache = result.data;
      populateHistoryFilters(); // Sinh Gợi ý & Dropdown
      filterHistoryLog("admin"); // Lọc bảng Admin
      filterHistoryLog("leader"); // Lọc bảng Leader
    }
  } catch (e) {
    console.error("Lỗi tải lịch sử:", e);
  }
}

function populateHistoryFilters() {
  // 1. Sinh danh sách Công đoạn (Stages)
  let stageOpts = '<option value="">-- Mọi công đoạn --</option>';
  globalStages.forEach((st) => {
    stageOpts += `<option value="${st.id}">${st.stage_name}</option>`;
  });
  if (document.getElementById("hist-stage"))
    document.getElementById("hist-stage").innerHTML = stageOpts;
  if (document.getElementById("hist-stage-ld"))
    document.getElementById("hist-stage-ld").innerHTML = stageOpts;

  // 2. Sinh Gợi ý (Autocomplete) gộp cả Mã Hàng và Số LOT
  const uniqueKeywords = [
    ...new Set([
      ...historyLogCache.map((h) => h.po_id),
      ...historyLogCache.map((h) => h.product_code),
    ]),
  ].filter(Boolean);

  const suggestHTML = uniqueKeywords
    .map((k) => `<option value="${k}">`)
    .join("");
  if (document.getElementById("hist-suggest"))
    document.getElementById("hist-suggest").innerHTML = suggestHTML;
  if (document.getElementById("hist-suggest-ld"))
    document.getElementById("hist-suggest-ld").innerHTML = suggestHTML;
}

window.filterHistoryLog = function (role) {
  const isLd = role === "leader";
  const dateFrom =
    document.getElementById(isLd ? "hist-date-from-ld" : "hist-date-from")
      ?.value || "";
  const dateTo =
    document.getElementById(isLd ? "hist-date-to-ld" : "hist-date-to")?.value ||
    "";
  const stageVal =
    document.getElementById(isLd ? "hist-stage-ld" : "hist-stage")?.value || "";
  const keyword = (
    document.getElementById(isLd ? "hist-keyword-ld" : "hist-keyword")?.value ||
    ""
  )
    .toUpperCase()
    .trim();

  const filtered = historyLogCache.filter((log) => {
    // Lọc ngày (Date Range)
    let matchDate = true;
    if (log.timestamp) {
      const logDate = log.timestamp.split(" ")[0]; // Cắt lấy phần yyyy-mm-dd
      if (dateFrom && logDate < dateFrom) matchDate = false;
      if (dateTo && logDate > dateTo) matchDate = false;
    }

    // Lọc công đoạn (Trùng Từ Trạm hoặc Đến Trạm)
    let matchStage = true;
    if (stageVal) {
      matchStage = log.from_stage === stageVal || log.to_stage === stageVal;
    }

    // Lọc Từ Khóa (Tìm trong LOT hoặc Mã Hàng)
    let matchKw = true;
    if (keyword) {
      const po = (log.po_id || "").toUpperCase();
      const prd = (log.product_code || "").toUpperCase();
      matchKw = po.includes(keyword) || prd.includes(keyword);
    }

    return matchDate && matchStage && matchKw;
  });

  renderHistoryTable(filtered, isLd ? "history-tbody-leader" : "history-tbody");
};

function renderHistoryTable(data, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  if (data.length > 0) {
    tbody.innerHTML = data
      .map((log) => {
        let timeStr = "Chưa rõ";
        if (log.timestamp) {
          try {
            const utcDate = new Date(log.timestamp.replace(" ", "T") + "Z");
            timeStr = utcDate.toLocaleString("vi-VN", {
              timeZone: "Asia/Ho_Chi_Minh",
              hour12: false,
            });
          } catch (e) {}
        }
        const typeStyle =
          log.type === "PASS"
            ? "color:#48BB78; font-weight:bold;"
            : "color:#ea580c; font-weight:bold;";
        const nameStr = log.full_name
          ? `${log.full_name} (${log.username})`
          : log.username || "Hệ thống";

        return `<tr>
                <td>${timeStr}</td>
                <td>${nameStr}</td>
                <td style="color:var(--navy); font-weight:bold;">${log.product_code || "-"}</td>
                <td style="font-weight:bold;">${log.po_id || "-"}</td>
                <td style="${typeStyle}">${log.type || "-"}</td>
                <td style="font-weight:bold; color:#e53e3e;">${log.qty || 0}</td>
                <td>${log.from_stage || "-"}</td>
                <td>${log.to_stage || "-"}</td>
            </tr>`;
      })
      .join("");
  } else {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px;">Không tìm thấy giao dịch nào!</td></tr>`;
  }
}

// ==========================================
// 3. LEADER: TẢI HÀNG CHỜ & KÉO ĐẨY
// ==========================================
async function fetchPendingPOs() {
  if (!currentUser || currentUser.role !== "LEADER") return;
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/leader/pending?line_id=${currentUser.line_id}`,
    );
    const result = await response.json();

    const newDataString = JSON.stringify(result.data || []);
    if (newDataString === lastPendingDataString) return;

    lastPendingDataString = newDataString;
    leaderPOsCache = result.data || [];
    populateLeaderSearchDropdowns();
  } catch (error) {}
}

window.populateLeaderSearchDropdowns = function () {
  const productList = document.getElementById("leader-product-list");
  if (!productList) {
    filterLeaderPOs();
    return;
  }

  // Lọc ra các mã hàng duy nhất
  const uniqueProducts = [
    ...new Set(leaderPOsCache.map((po) => po.product_code)),
  ].filter(Boolean);

  // Bơm danh sách vào thẻ datalist để làm gợi ý
  productList.innerHTML = uniqueProducts
    .map((p) => `<option value="${p}">`)
    .join("");

  updateLeaderLotOptions();
};

window.updateLeaderLotOptions = function () {
  const productInput = document.getElementById("search-leader-product");
  const lotList = document.getElementById("leader-lot-list");
  if (!productInput || !lotList) return;

  const selectedProduct = productInput.value.trim().toUpperCase();
  let availableLots = leaderPOsCache;

  // Nếu Leader gõ Mã hàng, lọc ra các số LOT thuộc mã đó (hoặc chứa chữ đó)
  if (selectedProduct) {
    availableLots = leaderPOsCache.filter((po) =>
      (po.product_code || "").toUpperCase().includes(selectedProduct),
    );
  }

  const uniqueLots = [
    ...new Set(availableLots.map((po) => po.po_number)),
  ].filter(Boolean);

  // Bơm danh sách LOT tương ứng vào datalist 2
  lotList.innerHTML = uniqueLots.map((l) => `<option value="${l}">`).join("");

  filterLeaderPOs();
};

window.filterLeaderPOs = function () {
  const prodVal =
    document
      .getElementById("search-leader-product")
      ?.value.trim()
      .toUpperCase() || "";
  const lotVal =
    document.getElementById("search-leader-lot")?.value.trim().toUpperCase() ||
    "";

  const filtered = leaderPOsCache.filter((po) => {
    // Dùng includes để chỉ cần gõ 1 phần (VD: gõ "TB" sẽ ra "TB-30")
    const matchProd =
      prodVal === "" || (po.product_code || "").toUpperCase().includes(prodVal);
    const matchLot =
      lotVal === "" || (po.po_number || "").toUpperCase().includes(lotVal);
    return matchProd && matchLot;
  });

  renderLeaderPOs(filtered);
};

window.filterLeaderPOs = function () {
  const prodVal = document.getElementById("search-leader-product")?.value || "";
  const lotVal = document.getElementById("search-leader-lot")?.value || "";

  const filtered = leaderPOsCache.filter((po) => {
    const matchProd = prodVal === "" || po.product_code === prodVal;
    const matchLot = lotVal === "" || po.po_number === lotVal;
    return matchProd && matchLot;
  });

  renderLeaderPOs(filtered);
};

function renderLeaderPOs(data) {
  const selectEl = document.getElementById("po-select");
  const wipContainer = document.getElementById("tab-wip");
  if (!selectEl || !wipContainer) return;

  let currentSelectedPoId = null;
  if (selectEl.value) {
    try {
      currentSelectedPoId = JSON.parse(selectEl.value).po_id;
    } catch (e) {}
  }

  selectEl.innerHTML = '<option value="">-- Chọn PO để xử lý --</option>';
  wipContainer.innerHTML = "";

  const stageNameDict = {
    CAT: "Cắt",
    NHIET_LUYEN: "Nhiệt luyện",
    DO_CUNG: "Độ cứng",
    NC1: "NC1",
    NC2: "NC2",
    NC3: "NC3",
    MNC1: "MNC1",
    MNC2: "MNC2",
    MNC3: "MNC3",
    GS: "GS",
    GV: "GV",
    GP: "GP",
    GE: "GE",
    GI: "GI",
    LAP_RAP: "Lắp ráp",
    DONG_THUNG: "Đóng thùng",
    XUAT_GCN: "Đi GCN",
    NHAN_GCN: "Nhận GCN",
    KIEM_TRA: "Kiểm tra",
  };

  if (data.length > 0) {
    data.forEach((po) => {
      const currentStageName =
        stageNameDict[po.from_stage.toUpperCase()] || po.from_stage;
      const toStageName = stageNameDict[po.to_stage_name] || po.to_stage_name;

      const optionValue = JSON.stringify({
        po_id: po.po_id,
        product_id: po.product_id,
        from_stage: po.from_stage,
        max_qty: po.qty_available,
      });

      const optionText = `${po.po_number} [${po.product_code}] - Tồn: ${po.qty_available} | ➔ Tới: ${toStageName}`;
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionText;
      selectEl.appendChild(option);

      const card = document.createElement("div");
      card.className = "card";
      card.style.borderLeft = "4px solid var(--lime)";
      card.innerHTML = `<h3 style="color: var(--navy); margin-bottom: 8px;">${po.po_number} <span style="font-size: 14px; color: var(--gray-dark);">(${po.product_code})</span></h3><p style="margin-bottom: 5px;">📦 Đang chờ: <strong class="text-primary" style="font-size: 18px;">${po.qty_available}</strong></p><p style="font-size: 14px;">📍 Hiện tại: <strong style="color: var(--maroon);">${currentStageName}</strong></p><p style="font-size: 14px;">➔ Sau khi PASS sẽ đến: <strong>${toStageName}</strong></p>`;
      wipContainer.appendChild(card);
    });

    if (currentSelectedPoId) {
      const options = Array.from(selectEl.options);
      const targetOpt = options.find((opt) => {
        if (!opt.value) return false;
        try {
          return JSON.parse(opt.value).po_id === currentSelectedPoId;
        } catch (e) {
          return false;
        }
      });
      if (targetOpt) selectEl.value = targetOpt.value;
    }
  } else {
    selectEl.innerHTML = '<option value="">Chưa có dữ liệu</option>';
    wipContainer.innerHTML = `<div class="card" style="text-align: center; color: var(--gray-dark); padding: 30px;">Không có lô hàng nào kẹt tại công đoạn bạn quản lý.</div>`;
  }
}

window.exportExcel = function () {
  const table = document.getElementById("export-table");
  if (!table) return alert("Không tìm thấy bảng dữ liệu để xuất!");

  let csv = "\uFEFF"; // Hỗ trợ hiển thị tiếng Việt trên Excel
  const rows = table.querySelectorAll("tr");

  rows.forEach((row) => {
    const cols = row.querySelectorAll("th, td");
    const rowData = Array.from(cols).map(
      (c) => `"${c.innerText.replace(/"/g, '""')}"`,
    );
    csv += rowData.join(",") + "\n";
  });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Bao_Cao_WIP_${new Date().toLocaleDateString("vi-VN").replace(/\//g, "-")}.csv`;
  link.click();
};

window.submitMove = async function () {
  const selectEl = document.getElementById("po-select");
  if (!selectEl) return;
  const selectedValue = selectEl.value;
  if (!selectedValue) return alert("Vui lòng chọn 1 PO!");

  const routeData = JSON.parse(selectedValue);
  const qtyPass = parseInt(document.getElementById("qty-pass").value) || 0;
  const qtyNg = parseInt(document.getElementById("qty-ng").value) || 0;
  if (qtyPass + qtyNg <= 0)
    return alert("Vui lòng nhập số lượng PASS hoặc NG!");
  if (qtyPass + qtyNg > routeData.max_qty)
    return alert(
      `Số lượng thao tác (${qtyPass + qtyNg}) vượt quá số lượng tồn (${routeData.max_qty})!`,
    );

  try {
    const response = await fetch(`${API_BASE_URL}/api/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lot_number: routeData.po_id,
        product_id: routeData.product_id,
        from_stage: routeData.from_stage,
        qty_pass: qtyPass,
        qty_ng: qtyNg,
        user_id: currentUser.id,
      }),
    });
    const data = await response.json();
    if (response.ok) {
      alert("Đã cập nhật luân chuyển thành công!");
      document.getElementById("qty-pass").value = 0;
      document.getElementById("qty-ng").value = 0;
      fetchPendingPOs();
    } else {
      alert(data.error);
    }
  } catch (error) {
    alert("Lỗi kết nối máy chủ API!");
  }
};

function setDefaultDates() {
  const d = new Date().toISOString().split("T")[0];
  if (document.getElementById("po-date"))
    document.getElementById("po-date").value = d;
  if (document.getElementById("action-date"))
    document.getElementById("action-date").value = d;
}
