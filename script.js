const API_BASE_URL = "https://api-ems-bic.quangtriet430.workers.dev";
let currentUser = null;
let globalStages = [];

// Các biến lưu trữ Cache và Interval để tự động làm mới
let currentMatrixData = null;
let leaderPOsCache = [];
let productsCache = [];
let adminPollingInterval = null;
let leaderPollingInterval = null;

// ==========================================
// 1. XỬ LÝ ĐĂNG NHẬP, ĐIỀU HƯỚNG & LOCALSTORAGE
// ==========================================

// Kiểm tra phiên đăng nhập cũ khi vừa tải trang
window.addEventListener("DOMContentLoaded", () => {
  setDefaultDates();

  const savedUser = localStorage.getItem("ems_user");
  if (savedUser) {
    currentUser = JSON.parse(savedUser);
    navigateToRoleScreen(); // Đăng nhập thẳng nếu có cache
  }
});

document.getElementById("password").addEventListener("keypress", function (e) {
  if (e.key === "Enter") {
    e.preventDefault();
    document.getElementById("login-form").dispatchEvent(new Event("submit"));
  }
});

document
  .getElementById("login-form")
  .addEventListener("submit", async function (e) {
    e.preventDefault();
    const usernameInput = document.getElementById("username").value;
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

      currentUser = data.user;
      // Lưu phiên đăng nhập vào LocalStorage
      localStorage.setItem("ems_user", JSON.stringify(currentUser));
      navigateToRoleScreen();
    } catch (error) {
      errorMsg.textContent = "Không thể kết nối đến máy chủ API.";
      errorMsg.classList.remove("hidden");
    }
  });

function logout() {
  currentUser = null;
  localStorage.removeItem("ems_user"); // Xóa cache đăng nhập

  // Dừng mọi tiến trình auto-refresh
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

  if (currentUser.role === "ADMIN") {
    document.getElementById("admin-screen").classList.remove("hidden");
    document.getElementById("admin-screen").classList.add("active");
    document.getElementById("admin-name").textContent = currentUser.username;

    // SỬA Ở ĐÂY: Thêm lệnh gọi load danh sách mã hàng
    loadNGDropdownsThorough().then(() => {
      fetchProductsList(); // Dòng này giúp bảng Master Data hiện lên
    });
    switchTab("admin", "tab-matrix");

    adminPollingInterval = setInterval(fetchMatrixReport, 5000);
  } else if (currentUser.role === "LEADER") {
    document.getElementById("leader-screen").classList.remove("hidden");
    document.getElementById("leader-screen").classList.add("active");

    document.getElementById("leader-name").textContent = currentUser.username;
    document.getElementById("leader-line").textContent =
      currentUser.line_id + " công đoạn";

    if (currentUser.line_id === 3 || currentUser.line_id === "3") {
      document.getElementById("btn-outsource").classList.remove("hidden");
    }

    switchTab("leader", "tab-wip");
    fetchPendingPOs();

    // Tự động refresh hàng chờ WIP mỗi 5 giây
    leaderPollingInterval = setInterval(fetchPendingPOs, 5000);
  }
}

function switchTab(role, tabId) {
  let container, btnClass, tabClass;

  if (role === "admin") {
    container = document.getElementById("admin-screen");
    btnClass = ".sidebar .tab-btn";
    tabClass = ".app-body .tab-content";
  } else {
    container = document.getElementById("leader-screen");
    btnClass = ".tabs-mobile .tab-btn-mobile";
    tabClass = ".content-mobile .tab-content";
  }

  container.querySelectorAll(tabClass).forEach((tab) => {
    tab.classList.remove("active");
    tab.classList.add("hidden");
  });

  container.querySelectorAll(btnClass).forEach((btn) => {
    btn.classList.remove("active");
  });

  document.getElementById(tabId).classList.remove("hidden");
  document.getElementById(tabId).classList.add("active");

  if (window.event && window.event.currentTarget) {
    window.event.currentTarget.classList.add("active");
  }

  if (role === "leader" && tabId === "tab-action") {
    fetchPendingPOs();
  }
  if (role === "admin" && tabId === "tab-matrix") {
    fetchMatrixReport();
  }
}

// ==========================================
// 2. LOGIC CHO LEADER (Thao tác Kéo/Đẩy Hàng)
// ==========================================

async function fetchPendingPOs() {
  if (!currentUser || currentUser.role !== "LEADER") return;

  try {
    // API THẬT CHO LEADER ĐÃ ĐƯỢC MỞ KHÓA
    const response = await fetch(
      `${API_BASE_URL}/api/leader/pending?line_id=${currentUser.line_id}`,
    );
    const result = await response.json();
    leaderPOsCache = result.data || [];

    filterLeaderPOs(); // Gọi hàm lọc để vẽ lại UI
  } catch (error) {
    document.getElementById("tab-wip").innerHTML =
      `<div class="card"><p class="text-error">Lỗi kết nối máy chủ API.</p></div>`;
  }
}

function renderLeaderPOs(data) {
  const selectEl = document.getElementById("po-select");
  const wipContainer = document.getElementById("tab-wip");

  // Giữ lại trạng thái lựa chọn của ô Dropdown trước khi re-render
  const currentSelection = selectEl.value;

  selectEl.innerHTML = '<option value="">-- Chọn PO để xử lý --</option>';
  wipContainer.innerHTML = "";

  if (data.length > 0) {
    data.forEach((po) => {
      const optionValue = JSON.stringify({
        po_id: po.po_id,
        from_stage: po.from_stage,
        to_stage: po.to_stage,
        max_qty: po.qty_available,
      });
      const nextStageText = po.to_stage_name
        ? po.to_stage_name
        : "Hoàn thành (Nhập kho)";
      const optionText = `${po.po_number} - Tồn: ${po.qty_available} | Đang ở: ${po.from_stage_name} ➔ Chuyển đến: ${nextStageText}`;

      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionText;
      selectEl.appendChild(option);

      const card = document.createElement("div");
      card.className = "card";
      card.style.borderLeft = "4px solid var(--lime)";
      card.innerHTML = `
        <h3 style="color: var(--navy); margin-bottom: 8px;">${po.po_number} <span style="font-size: 14px; color: var(--gray-dark);">(${po.product_code})</span></h3>
        <p style="margin-bottom: 5px;">📦 Số lượng đang chờ: <strong class="text-primary" style="font-size: 18px;">${po.qty_available}</strong></p>
        <p style="font-size: 14px;">📍 Công đoạn hiện tại: <strong style="color: var(--maroon);">${po.from_stage_name}</strong></p>
        <p style="font-size: 14px;">➔ Sau khi PASS sẽ đến: <strong>${nextStageText}</strong></p>
      `;
      wipContainer.appendChild(card);
    });

    // Phục hồi lại lựa chọn nếu tồn tại trong danh sách mới
    if ([...selectEl.options].some((opt) => opt.value === currentSelection)) {
      selectEl.value = currentSelection;
    }
  } else {
    selectEl.innerHTML =
      '<option value="">-- Không có hàng thỏa mãn --</option>';
    wipContainer.innerHTML = `<div class="card" style="text-align: center; color: var(--gray-dark); padding: 30px;">Không có lô hàng nào kẹt tại công đoạn bạn quản lý.</div>`;
  }
}

window.filterLeaderPOs = function () {
  const searchInput = document.getElementById("search-leader-po");
  if (!searchInput) return;

  const searchVal = searchInput.value.toLowerCase();
  const filtered = leaderPOsCache.filter((po) => {
    return (
      po.po_number.toLowerCase().includes(searchVal) ||
      po.product_code.toLowerCase().includes(searchVal)
    );
  });
  renderLeaderPOs(filtered);
};

async function submitMove() {
  const selectEl = document.getElementById("po-select");
  const selectedValue = selectEl.value;

  if (!selectedValue) {
    alert("Vui lòng chọn 1 PO!");
    return;
  }

  const routeData = JSON.parse(selectedValue);
  const qtyPass = parseInt(document.getElementById("qty-pass").value) || 0;
  const qtyNg = parseInt(document.getElementById("qty-ng").value) || 0;
  const actionDate = document.getElementById("action-date").value;
  const totalInput = qtyPass + qtyNg;

  if (totalInput <= 0) {
    alert("Vui lòng nhập số lượng PASS hoặc NG!");
    return;
  }

  if (!actionDate) {
    alert("Vui lòng chọn ngày thực hiện!");
    return;
  }

  if (totalInput > routeData.max_qty) {
    alert(
      `Số lượng thao tác (${totalInput}) vượt quá số lượng tồn (${routeData.max_qty})!`,
    );
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        po_id: routeData.po_id,
        from_stage: routeData.from_stage,
        to_stage: routeData.to_stage,
        qty_pass: qtyPass,
        qty_ng: qtyNg,
        action_date: actionDate,
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
}

const btnOutsource = document.getElementById("btn-outsource");
if (btnOutsource) {
  btnOutsource.addEventListener("click", async function () {
    const selectEl = document.getElementById("po-select");
    const selectedValue = selectEl.value;

    if (!selectedValue) {
      alert("Vui lòng chọn 1 PO!");
      return;
    }

    const routeData = JSON.parse(selectedValue);
    const actionInput = prompt(
      "Nhập số 1 để XUẤT gia công\nNhập số 2 để NHẬP gia công về\n(Hoặc bấm Hủy để thoát):",
    );

    if (!actionInput) return;

    let action = "";
    if (actionInput === "1") action = "EXPORT";
    else if (actionInput === "2") action = "IMPORT";
    else {
      alert("Lựa chọn không hợp lệ!");
      return;
    }

    const qtyInput = prompt(
      `Bạn muốn ${action === "EXPORT" ? "XUẤT" : "NHẬP"} bao nhiêu sản phẩm?`,
    );
    const qty = parseInt(qtyInput);

    if (!qty || qty <= 0) {
      alert("Số lượng không hợp lệ!");
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/outsource`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          po_id: routeData.po_id,
          stage_id: routeData.from_stage,
          action: action,
          qty: qty,
          user_id: currentUser.id,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        alert(data.message);
        fetchPendingPOs();
      } else {
        alert(data.error);
      }
    } catch (error) {
      alert("Lỗi kết nối máy chủ API!");
    }
  });
}

// ==========================================
// 3. LOGIC CHO ADMIN
// ==========================================

async function fetchMatrixReport() {
  if (!currentUser || currentUser.role !== "ADMIN") return;

  try {
    const response = await fetch(`${API_BASE_URL}/api/dashboard/matrix`);
    const data = await response.json();

    if (!data.matrix) {
      console.error("Lỗi tải báo cáo Matrix");
      return;
    }

    const columns = [
      { id: "Cutting", stage_name: "Cắt" },
      { id: "NC", stage_name: "NC" },
      { id: "MNC", stage_name: "MNC" },
      { id: "GS_GS", stage_name: "GS_GS" },
      { id: "GP_GE", stage_name: "GP_GE" },
      { id: "Assy", stage_name: "Lắp Ráp" },
      { id: "Kensa", stage_name: "Kensa" },
      { id: "Barry", stage_name: "Barry" },
    ];

    const rows = data.matrix.map((row) => {
      return {
        production_date: "",
        po_number: row.lot_number,
        product_code: row.product_code,
        total_qty: row.total_qty,
        total_ng: row.qty_ng,
        finished_qty: row.qty_done,
        stages: {
          Cutting: { good: row.qty_cutting, ng: 0, outsource: 0 },
          NC: { good: row.qty_nc, ng: 0, outsource: 0 },
          MNC: { good: row.qty_mnc, ng: 0, outsource: 0 },
          GS_GS: { good: row.qty_gs_gs, ng: 0, outsource: 0 },
          GP_GE: { good: row.qty_gp_ge, ng: 0, outsource: 0 },
          Assy: { good: row.qty_assy, ng: 0, outsource: 0 },
          Kensa: { good: row.qty_kensa, ng: 0, outsource: 0 },
          Barry: { good: row.qty_barry, ng: 0, outsource: 0 },
        },
      };
    });

    currentMatrixData = { columns, rows };
    filterMatrix();
  } catch (error) {
    console.error("Lỗi vẽ Ma trận:", error);
  }
}

// Hàm lấy dữ liệu Master Data từ Backend
async function fetchProductsList() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/products`);
    const data = await response.json();
    if (data.products) {
      productsCache = data.products;
      renderProductSuggestions(); // Đổ dữ liệu vào Autocomplete
      renderMasterTable(productsCache); // Đổ dữ liệu vào bảng
    }
  } catch (e) {
    console.error("Lỗi tải danh sách mã hàng", e);
  }
}

// 1. Tạo Datalist Gợi ý cho Ô nhập LOT
function renderProductSuggestions() {
  const datalist = document.getElementById("product-suggestions");
  if (!datalist) return;
  datalist.innerHTML = productsCache
    .map((p) => `<option value="${p.product_code}">${p.product_name}</option>`)
    .join("");
}

// 2. Vẽ Bảng bên cạnh phần Master Data
function renderMasterTable(data) {
  const container = document.getElementById("master-list-container");
  if (!container) return;

  if (data.length === 0) {
    container.innerHTML =
      "<p>Chưa có dữ liệu. Hãy tạo mã hàng mới bên trái.</p>";
    return;
  }

  let html = `<table class="matrix-table" style="font-size: 13px;"><thead><tr><th>Mã Hàng</th><th>Tên</th><th>Lộ trình (Trạm)</th></tr></thead><tbody>`;

  data.forEach((p) => {
    let routingText = "";
    try {
      const map = JSON.parse(p.routing_map);
      const stageNames = map.map((step) => {
        const sId = step.stage_id ? step.stage_id : step;
        const stageObj = globalStages.find((st) => st.id == sId);
        return stageObj ? stageObj.stage_name : sId;
      });
      routingText = stageNames.join(" ➔ ");
    } catch (e) {
      routingText = "Lỗi dữ liệu";
    }

    html += `<tr>
            <td style="font-weight:bold; color:var(--navy);">${p.product_code}</td>
            <td>${p.product_name}</td>
            <td>${routingText}</td>
        </tr>`;
  });
  html += `</tbody></table>`;
  container.innerHTML = html;
}

// 3. Hàm Search động cho Bảng Mã Hàng
window.filterMasterData = function () {
  const val = document.getElementById("search-master").value.toLowerCase();
  const filtered = productsCache.filter(
    (p) =>
      p.product_code.toLowerCase().includes(val) ||
      (p.product_name || "").toLowerCase().includes(val),
  );
  renderMasterTable(filtered);
};

function renderMatrixTable(rows) {
  const container = document.getElementById("matrix-table-container");
  if (!currentMatrixData || !container) return;

  let tableHTML = `<table class="matrix-table" id="export-table"><thead><tr>`;
  tableHTML += `<th>Ngày tháng</th><th>Số PO / LOT</th><th>Mã Hàng</th><th>Tổng SL</th>`;
  currentMatrixData.columns.forEach((col) => {
    tableHTML += `<th>${col.stage_name}</th>`;
  });
  tableHTML += `<th>HÀNG NG</th><th>THÀNH PHẨM</th></tr></thead><tbody>`;

  if (rows.length === 0) {
    tableHTML += `<tr><td colspan="${currentMatrixData.columns.length + 6}" style="text-align:center; padding: 20px;">Không tìm thấy dữ liệu khớp kết quả lọc.</td></tr>`;
  }

  rows.forEach((row) => {
    tableHTML += `<tr>
      <td>${row.production_date || "-"}</td>
      <td style="font-weight:bold; color:var(--navy);">${row.po_number}</td>
      <td>${row.product_code}</td>
      <td style="font-weight:bold;">${row.total_qty}</td>`;

    currentMatrixData.columns.forEach((col) => {
      const stageData = row.stages[col.id];
      if (stageData) {
        let cellContent = "";
        if (stageData.good > 0)
          cellContent += `<span class="badge-good">${stageData.good}</span>`;
        if (stageData.ng > 0)
          cellContent += `<span class="badge-ng">${stageData.ng} NG</span>`;
        if (stageData.outsource > 0)
          cellContent += `<span class="badge-out">${stageData.outsource} GC</span>`;
        tableHTML += `<td>${cellContent || '<span class="cell-empty">-</span>'}</td>`;
      } else {
        tableHTML += `<td><span class="cell-empty">-</span></td>`;
      }
    });

    tableHTML += `<td style="font-weight:bold; color:#ea580c;">${row.total_ng > 0 ? row.total_ng : "-"}</td>`;
    tableHTML += `<td style="font-weight:bold; color:#48BB78;">${row.finished_qty > 0 ? row.finished_qty : "-"}</td></tr>`;
  });

  tableHTML += `</tbody></table>`;
  container.innerHTML = tableHTML;
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

  const filtered = currentMatrixData.rows.filter((row) => {
    const matchDate = (row.production_date || "")
      .toLowerCase()
      .includes(dateVal);
    const matchLot = (row.po_number || "").toLowerCase().includes(lotVal);
    const matchCode = (row.product_code || "").toLowerCase().includes(codeVal);
    return matchDate && matchLot && matchCode;
  });
  renderMatrixTable(filtered);
};

window.exportExcel = function () {
  const table = document.getElementById("export-table");
  if (!table) return;
  const html = table.outerHTML;
  const url =
    "data:application/vnd.ms-excel;charset=utf-8," +
    encodeURIComponent("\uFEFF" + html);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Bao_Cao_WIP_${new Date().toISOString().slice(0, 10)}.xls`;
  link.click();
};

let routingStepCount = 0;

window.addRoutingStep = function () {
  if (globalStages.length === 0) {
    alert(
      "Hệ thống đang tải danh sách công đoạn, vui lòng thử lại sau 1 giây.",
    );
    loadNGDropdownsThorough();
    return;
  }
  routingStepCount++;
  const container = document.getElementById("routing-builder");

  const stepDiv = document.createElement("div");
  stepDiv.style.marginBottom = "10px";
  stepDiv.style.display = "flex";
  stepDiv.style.alignItems = "center";
  stepDiv.style.gap = "10px";

  stepDiv.innerHTML = `
      <span style="font-weight:bold; min-width: 70px;">Bước ${routingStepCount}:</span>
      <select class="routing-stage-select" required style="padding: 8px; flex: 1; border-radius: 4px; border: 1px solid #ccc;">
          <option value="">-- Chọn công đoạn --</option>
          ${globalStages.map((s) => `<option value="${s.id}">${s.stage_name}</option>`).join("")}
      </select>
      <button type="button" class="btn btn-danger" style="padding: 8px 12px; font-size:12px;" onclick="this.parentElement.remove()">Xóa</button>
  `;
  container.appendChild(stepDiv);
};

const formCreateProduct = document.getElementById("form-create-product");
if (formCreateProduct) {
  formCreateProduct.addEventListener("submit", async function (e) {
    e.preventDefault();
    const productCode = document.getElementById("md-product-code").value.trim();
    const productName = document.getElementById("md-product-name").value.trim();
    const selects = document.querySelectorAll(".routing-stage-select");
    const routingMap = [];

    selects.forEach((select, index) => {
      if (select.value) {
        routingMap.push({ order: index + 1, stage_id: select.value }); // Giữ nguyên ID dạng chữ (Cutting, NC...) nếu trạm gán chữ
      }
    });

    if (routingMap.length === 0) {
      alert("Vui lòng thêm ít nhất 1 công đoạn vào lộ trình sản xuất!");
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_code: productCode,
          product_name: productName,
          routing_map: routingMap,
        }),
      });
      const data = await response.json();
      if (response.ok) {
        alert("Khởi tạo mã hàng thành công!");
        document.getElementById("form-create-product").reset();
        document.getElementById("routing-builder").innerHTML = "";
        routingStepCount = 0;
        fetchProductsList(); // Gọi lại để bảng cập nhật luôn
      } else {
        alert("Lỗi: " + data.error);
      }
    } catch (error) {
      alert("Lỗi kết nối API!");
    }
  });
}

const formCreatePO = document.getElementById("form-create-po");
if (formCreatePO) {
  formCreatePO.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!currentUser) return;

    const prefix = document.getElementById("po-prefix").value.trim();
    const productCode = document.getElementById("product-code").value.trim();
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

    const confirmMsg = `Hệ thống sẽ chẻ thành ${lots.length} LOT (${lots.map((l) => l.qty).join(", ")}).\nBạn có chắc chắn?`;
    if (!confirm(confirmMsg)) return;

    let successCount = 0;
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
        if (response.ok) successCount++;
      } catch (err) {
        console.error("Lỗi tạo LOT:", lot.po_number);
      }
    }

    alert(
      `Đã cấp phát thành công ${successCount}/${lots.length} LOT vào dây chuyền!`,
    );
    document.getElementById("form-create-po").reset();
    setDefaultDates();
    loadNGDropdownsThorough();
    fetchMatrixReport(); // Làm mới matrix nếu Admin đang ở tab đó
  });
}

window.toggleReworkStage = function () {
  const action = document.getElementById("ng-action").value;
  const groupReturn = document.getElementById("group-return-stage");
  const inputReturn = document.getElementById("ng-return-stage");

  if (action === "REWORK") {
    groupReturn.classList.remove("hidden");
    inputReturn.required = true;
  } else {
    groupReturn.classList.add("hidden");
    inputReturn.required = false;
    inputReturn.value = "";
  }
};

async function loadNGDropdownsThorough() {
  try {
    const [poRes, stageRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/po/list`),
      fetch(`${API_BASE_URL}/api/stages`),
    ]);

    const poData = await poRes.json();
    const stageData = await stageRes.json();

    let poOpts = '<option value="">-- Chọn Lô / PO --</option>';
    if (poData.data) {
      poData.data.forEach((po) => {
        poOpts += `<option value="${po.id}">${po.po_number} [${po.product_code}]</option>`;
      });
    }
    const poSelect = document.getElementById("ng-po-select");
    if (poSelect) poSelect.innerHTML = poOpts;

    let stageOpts = '<option value="">-- Chọn công đoạn --</option>';
    if (stageData.data) {
      globalStages = stageData.data;
      stageData.data.forEach((col) => {
        stageOpts += `<option value="${col.id}">${col.stage_name}</option>`;
      });
    }
    const curStage = document.getElementById("ng-current-stage");
    const retStage = document.getElementById("ng-return-stage");
    if (curStage) curStage.innerHTML = stageOpts;
    if (retStage) retStage.innerHTML = stageOpts;
  } catch (e) {
    console.error("Lỗi nạp Dropdown:", e);
  }
}

const formResolveNg = document.getElementById("form-resolve-ng");
if (formResolveNg) {
  formResolveNg.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!currentUser) return;

    const action = document.getElementById("ng-action").value;
    const payload = {
      po_id: parseInt(document.getElementById("ng-po-select").value),
      current_stage: parseInt(
        document.getElementById("ng-current-stage").value,
      ),
      action: action,
      return_stage_id:
        action === "REWORK"
          ? parseInt(document.getElementById("ng-return-stage").value)
          : null,
      qty: parseInt(document.getElementById("ng-qty").value),
      user_id: currentUser.id,
    };

    if (!payload.po_id) {
      alert("Vui lòng chọn 1 LOT/PO");
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/ng/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (response.ok) {
        alert("Thành công: " + data.message);
        document.getElementById("form-resolve-ng").reset();
        toggleReworkStage();
        fetchMatrixReport(); // Cập nhật lại số liệu NG
      } else {
        alert("Lỗi: " + data.error);
      }
    } catch (error) {
      alert("Lỗi kết nối máy chủ API!");
    }
  });
}

function setDefaultDates() {
  const today = new Date().toISOString().split("T")[0];
  const poDateInput = document.getElementById("po-date");
  const actionDateInput = document.getElementById("action-date");

  if (poDateInput) poDateInput.value = today;
  if (actionDateInput) actionDateInput.value = today;
}
