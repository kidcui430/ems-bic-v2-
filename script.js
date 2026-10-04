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

    // Tải danh sách trạm trước, sau đó lọc ra các trạm con thuộc Line này
    loadNGDropdownsThorough().then(() => {
      const myStages = globalStages.filter(
        (s) => s.line_id === currentUser.line_id,
      );
      if (myStages.length > 0) {
        const stageNames = myStages.map((s) => s.stage_name).join(", ");
        document.getElementById("leader-line").textContent = `${stageNames}`;
      } else {
        document.getElementById("leader-line").textContent =
          `Line: ${currentUser.line_id}`;
      }

      // Tải danh sách hàng chờ sau khi đã thiết lập xong UI
      switchTab("leader", "tab-wip");
      fetchPendingPOs();
    });

    // Ẩn/hiện nút Gia Công Ngoài
    if (currentUser.line_id === "ASSY") {
      document.getElementById("btn-outsource")?.classList.remove("hidden");
    }

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
async function loadNGDropdownsThorough() {
  const fallbackStages = [
    { id: "CAT", stage_name: "Cắt" },
    { id: "NC1", stage_name: "NC1" },
    { id: "MNC1", stage_name: "MNC1" },
    { id: "GS_GV", stage_name: "GS-GV" },
    { id: "GP_GE", stage_name: "GP-GE" },
    { id: "LAP_RAP", stage_name: "Lắp ráp" },
  ];

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

  // Đổ dữ liệu vào Dropdown Công đoạn (Current Stage & Return Stage)
  let stageOpts = '<option value="">-- Chọn công đoạn --</option>';
  globalStages.forEach((col) => {
    stageOpts += `<option value="${col.id}">${col.stage_name}</option>`;
  });
  const curStage = document.getElementById("ng-current-stage");
  const retStage = document.getElementById("ng-return-stage");
  if (curStage) curStage.innerHTML = stageOpts;
  if (retStage) retStage.innerHTML = stageOpts;

  // Gọi API lấy riêng các PO đang có hàng NG
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

    // Dùng globalStages (16 trạm) để làm cột Header cho Bảng TK
    const columns = globalStages;

    const rows = data.matrix.map((row) => {
      return {
        production_date: row.production_date,
        po_number: row.lot_number,
        product_code: row.product_code,
        total_qty: row.total_qty,
        total_ng: row.qty_ng,
        finished_qty: row.qty_done,
        stages: {
          CAT: { good: row.qty_cat },
          NHIET_LUYEN: { good: row.qty_nhiet_luyen },
          DO_CUNG: { good: row.qty_do_cung },
          NC1: { good: row.qty_nc1 },
          NC2: { good: row.qty_nc2 },
          NC3: { good: row.qty_nc3 },
          MNC1: { good: row.qty_mnc1 },
          MNC2: { good: row.qty_mnc2 },
          MNC3: { good: row.qty_mnc3 },
          GS_GV: { good: row.qty_gs_gv },
          GP_GE: { good: row.qty_gp_ge },
          LAP_RAP: { good: row.qty_lap_rap },
          DONG_THUNG: { good: row.qty_dong_thung },
          XUAT_GCN: { good: row.qty_xuat_gcn },
          NHAN_GCN: { good: row.qty_nhan_gcn },
          KIEM_TRA: { good: row.qty_kiem_tra },
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
// KHU VỰC LEADER (TẢI HÀNG CHỜ & KÉO/ĐẨY)
// ==========================================

async function fetchPendingPOs() {
  if (!currentUser || currentUser.role !== "LEADER") return;

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/leader/pending?line_id=${currentUser.line_id}`,
    );
    const result = await response.json();
    leaderPOsCache = result.data || [];
    filterLeaderPOs();
  } catch (error) {
    const wipContainer = document.getElementById("tab-wip");
    if (wipContainer)
      wipContainer.innerHTML = `<div class="card"><p class="text-error">Lỗi kết nối máy chủ API.</p></div>`;
  }
}

function renderLeaderPOs(data) {
  const selectEl = document.getElementById("po-select");
  const wipContainer = document.getElementById("tab-wip");
  if (!selectEl || !wipContainer) return;

  const currentSelection = selectEl.value;
  selectEl.innerHTML = '<option value="">-- Chọn PO để xử lý --</option>';
  wipContainer.innerHTML = "";

  if (data.length > 0) {
    data.forEach((po) => {
      const optionValue = JSON.stringify({
        po_id: po.po_id,
        product_id: po.product_id,
        from_stage: po.from_stage,
        max_qty: po.qty_available,
      });

      const optionText = `${po.po_number} [${po.product_code}] - Tồn: ${po.qty_available} | Đang ở: ${po.from_stage_name} ➔ Trạm tới: ${po.to_stage_name}`;
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionText;
      selectEl.appendChild(option);

      const card = document.createElement("div");
      card.className = "card";
      card.style.borderLeft = "4px solid var(--lime)";
      card.innerHTML = `
                <h3 style="color: var(--navy); margin-bottom: 8px;">${po.po_number} <span style="font-size: 14px; color: var(--gray-dark);">(${po.product_code})</span></h3>
                <p style="margin-bottom: 5px;">📦 Đang chờ: <strong class="text-primary" style="font-size: 18px;">${po.qty_available}</strong></p>
                <p style="font-size: 14px;">📍 Hiện tại: <strong style="color: var(--maroon);">${po.from_stage_name}</strong></p>
                <p style="font-size: 14px;">➔ Sau khi PASS sẽ đến: <strong>${po.to_stage_name}</strong></p>
            `;
      wipContainer.appendChild(card);
    });

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
      (po.po_number || "").toLowerCase().includes(searchVal) ||
      (po.product_code || "").toLowerCase().includes(searchVal)
    );
  });
  renderLeaderPOs(filtered);
};

window.submitMove = async function () {
  const selectEl = document.getElementById("po-select");
  if (!selectEl) return;
  const selectedValue = selectEl.value;

  if (!selectedValue) {
    alert("Vui lòng chọn 1 PO!");
    return;
  }

  const routeData = JSON.parse(selectedValue);
  const qtyPass = parseInt(document.getElementById("qty-pass").value) || 0;
  const qtyNg = parseInt(document.getElementById("qty-ng").value) || 0;
  const totalInput = qtyPass + qtyNg;

  if (totalInput <= 0) {
    alert("Vui lòng nhập số lượng PASS hoặc NG!");
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
