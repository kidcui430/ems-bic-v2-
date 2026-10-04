const API_BASE_URL = "https://api-ems-bic.quangtriet430.workers.dev"; // Sửa lại đúng URL của bạn nếu cần
let currentUser = null;
let globalStages = [];

let currentMatrixData = null;
let leaderPOsCache = [];
let productsCache = [];
let adminPollingInterval = null;
let leaderPollingInterval = null;

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
      localStorage.setItem("ems_user", JSON.stringify(currentUser));
      navigateToRoleScreen();
    } catch (error) {
      errorMsg.textContent = "Không thể kết nối đến máy chủ API.";
      errorMsg.classList.remove("hidden");
    }
  });

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

  if (currentUser.role === "ADMIN") {
    document.getElementById("admin-screen").classList.remove("hidden");
    document.getElementById("admin-screen").classList.add("active");
    document.getElementById("admin-name").textContent = currentUser.username;

    // Tải các trạm trước, sau đó tải Master Data
    loadNGDropdownsThorough().then(() => {
      fetchProductsList();
    });

    switchTab("admin", "tab-matrix");
    adminPollingInterval = setInterval(fetchMatrixReport, 5000);
  } else if (currentUser.role === "LEADER") {
    document.getElementById("leader-screen").classList.remove("hidden");
    document.getElementById("leader-screen").classList.add("active");
    document.getElementById("leader-name").textContent = currentUser.username;
    document.getElementById("leader-line").textContent =
      currentUser.line_id + " công đoạn";

    switchTab("leader", "tab-wip");
    fetchPendingPOs();
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
  if (role === "admin" && tabId === "tab-matrix") fetchMatrixReport();
}

// ==========================================
// 2. KHU VỰC ADMIN (TẠO MÃ, PO, MATRIX)
// ==========================================

// --- KHAI BÁO CÔNG ĐOẠN ---
// Sửa đổi cực kỳ quan trọng: Thêm Fallback array để cứu app nếu API rớt
async function loadNGDropdownsThorough() {
  // Đây là danh sách gốc đề phòng Worker chưa cập nhật / lỗi API
  const fallbackStages = [
    { id: "Cutting", stage_name: "Cắt" },
    { id: "NC", stage_name: "NC" },
    { id: "MNC", stage_name: "MNC" },
    { id: "GS_GS", stage_name: "GS_GS" },
    { id: "GP_GE", stage_name: "GP_GE" },
    { id: "Assy", stage_name: "Lắp Ráp" },
    { id: "Kensa", stage_name: "Kensa" },
    { id: "Barry", stage_name: "Barry" },
  ];

  try {
    const stageRes = await fetch(`${API_BASE_URL}/api/stages`);
    const stageData = await stageRes.json();

    if (stageData.data && stageData.data.length > 0) {
      globalStages = stageData.data;
    } else {
      globalStages = fallbackStages; // Cứu cánh
    }
  } catch (e) {
    globalStages = fallbackStages; // Cứu cánh nếu mất mạng
  }

  // Render HTML cho dropdown NG (nếu có)
  let stageOpts = '<option value="">-- Chọn công đoạn --</option>';
  globalStages.forEach((col) => {
    stageOpts += `<option value="${col.id}">${col.stage_name}</option>`;
  });

  const curStage = document.getElementById("ng-current-stage");
  const retStage = document.getElementById("ng-return-stage");
  if (curStage) curStage.innerHTML = stageOpts;
  if (retStage) retStage.innerHTML = stageOpts;
}

let routingStepCount = 0;
window.addRoutingStep = function () {
  if (globalStages.length === 0) {
    alert("Chưa có danh sách công đoạn. Vui lòng tải lại trang!");
    return;
  }
  routingStepCount++;
  const container = document.getElementById("routing-builder");
  const stepDiv = document.createElement("div");
  stepDiv.style.marginBottom = "10px";
  stepDiv.style.display = "flex";
  stepDiv.style.gap = "10px";

  stepDiv.innerHTML = `
        <span style="font-weight:bold; min-width: 70px;">Bước ${routingStepCount}:</span>
        <select class="routing-stage-select" required style="padding: 8px; flex: 1;">
            <option value="">-- Chọn công đoạn --</option>
            ${globalStages.map((s) => `<option value="${s.id}">${s.stage_name}</option>`).join("")}
        </select>
        <button type="button" class="btn btn-danger" onclick="this.parentElement.remove()">Xóa</button>
    `;
  container.appendChild(stepDiv);
};

// --- TẠO MÃ HÀNG (MASTER DATA) ---
const formCreateProduct = document.getElementById("form-create-product");
if (formCreateProduct) {
  formCreateProduct.addEventListener("submit", async function (e) {
    e.preventDefault();
    // SỬA LỖI: Ép in hoa chữ để đồng nhất với tìm kiếm
    const productCode = document
      .getElementById("md-product-code")
      .value.trim()
      .toUpperCase();
    const productName = document.getElementById("md-product-name").value.trim();
    const selects = document.querySelectorAll(".routing-stage-select");
    const routingMap = [];

    selects.forEach((select, index) => {
      if (select.value) {
        routingMap.push({ order: index + 1, stage_id: select.value });
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
        fetchProductsList(); // Cập nhật lại list luôn
      } else {
        alert("Lỗi: " + data.error);
      }
    } catch (error) {
      alert("Lỗi kết nối API!");
    }
  });
}

// --- API FETCH DANH SÁCH MÃ HÀNG ---
async function fetchProductsList() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/products`);
    const data = await response.json();
    if (data.products) {
      productsCache = data.products;
      renderProductSuggestions();
      renderMasterTable(productsCache);
    }
  } catch (e) {
    console.error("Lỗi tải danh sách mã hàng", e);
  }
}

function renderProductSuggestions() {
  const datalist = document.getElementById("product-suggestions");
  if (!datalist) return;
  datalist.innerHTML = productsCache
    .map((p) => `<option value="${p.product_code}">${p.product_name}</option>`)
    .join("");
}

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

window.filterMasterData = function () {
  const val = document.getElementById("search-master").value.toLowerCase();
  const filtered = productsCache.filter(
    (p) =>
      p.product_code.toLowerCase().includes(val) ||
      (p.product_name || "").toLowerCase().includes(val),
  );
  renderMasterTable(filtered);
};

// --- TẠO VÀ CHIA LOT (XỬ LÝ LỖI TRƯỚC ĐÂY) ---
const formCreatePO = document.getElementById("form-create-po");
if (formCreatePO) {
  formCreatePO.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!currentUser) return;

    const prefix = document
      .getElementById("po-prefix")
      .value.trim()
      .toUpperCase();
    // Ép mã hàng thành in hoa
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

    const confirmMsg = `Hệ thống sẽ chẻ thành ${lots.length} LOT (${lots.map((l) => l.qty).join(", ")}).\nBạn có chắc chắn?`;
    if (!confirm(confirmMsg)) return;

    // Xử lý báo lỗi minh bạch
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

    if (errorMessages.length > 0) {
      alert(
        `Đã tạo được ${successCount}/${lots.length} LOT.\nDanh sách lỗi:\n` +
          errorMessages.join("\n"),
      );
    } else {
      alert(
        `Đã cấp phát THÀNH CÔNG ${successCount}/${lots.length} LOT vào dây chuyền!`,
      );
      document.getElementById("form-create-po").reset();
      setDefaultDates();
    }

    fetchMatrixReport(); // Cập nhật lại Matrix
  });
}

// --- BÁO CÁO MATRIX ---
async function fetchMatrixReport() {
  if (!currentUser || currentUser.role !== "ADMIN") return;
  try {
    const response = await fetch(`${API_BASE_URL}/api/dashboard/matrix`);
    const data = await response.json();
    if (!data.matrix) return;

    const columns =
      globalStages.length > 0
        ? globalStages
        : [
            { id: "Cutting", stage_name: "Cắt" },
            { id: "NC", stage_name: "NC" },
            { id: "MNC", stage_name: "MNC" },
            { id: "Assy", stage_name: "Lắp Ráp" },
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
          Assy: { good: row.qty_assy, ng: 0, outsource: 0 },
        },
      };
    });
    currentMatrixData = { columns, rows };
    filterMatrix();
  } catch (error) {
    console.error("Lỗi vẽ Ma trận:", error);
  }
}

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
    tableHTML += `<tr><td colspan="${currentMatrixData.columns.length + 6}" style="text-align:center; padding: 20px;">Không tìm thấy dữ liệu.</td></tr>`;
  }

  rows.forEach((row) => {
    tableHTML += `<tr>
        <td>${row.production_date || "-"}</td>
        <td style="font-weight:bold; color:var(--navy);">${row.po_number}</td>
        <td>${row.product_code}</td>
        <td style="font-weight:bold;">${row.total_qty}</td>`;

    currentMatrixData.columns.forEach((col) => {
      const stageData = row.stages[col.id];
      if (stageData && stageData.good > 0) {
        tableHTML += `<td><span class="badge-good">${stageData.good}</span></td>`;
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

// ==========================================
// 3. TIỆN ÍCH DÙNG CHUNG
// ==========================================
function setDefaultDates() {
  const today = new Date().toISOString().split("T")[0];
  const poDateInput = document.getElementById("po-date");
  const actionDateInput = document.getElementById("action-date");
  if (poDateInput) poDateInput.value = today;
  if (actionDateInput) actionDateInput.value = today;
}
