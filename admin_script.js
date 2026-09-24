const SUPABASE_URL = 'https://wohnxhepcaqxyzrgjbrj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndvaG54aGVwY2FxeHl6cmdqYnJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwNzE4MjgsImV4cCI6MjEwNTY0NzgyOH0.KvQXewy2kBRwGJB8treP2QFu6Cj6maVGxSRYlhoGTAw'; // Key cũ

let supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let revenueChartInstance = null;

// Chuyển Tab
function switchAdminTab(tabId, element) {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    element.classList.add('active');
    
    document.querySelectorAll('.admin-tab').forEach(tab => tab.classList.remove('active-tab'));
    document.getElementById(tabId).classList.add('active-tab');
    
    if (tabId === 'tabRevenue') fetchRevenueData();
}

// Hàm format tiền
const fmtMoney = (num) => (num || 0).toLocaleString('vi-VN') + 'đ';

// Hàm gán bộ lọc nhanh
function setQuickFilter(type) {
    const today = new Date();
    const endInput = document.getElementById('filterEnd');
    const startInput = document.getElementById('filterStart');
    
    endInput.value = today.toISOString().split('T')[0];

    let start = new Date();
    if (type === '7days') {
        start.setDate(today.getDate() - 6);
    } else if (type === 'thisMonth') {
        start = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (type === 'lastMonth') {
        start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        let endLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
        endInput.value = endLastMonth.toISOString().split('T')[0];
    }
    
    // Convert to local YYYY-MM-DD
    const tzOffset = start.getTimezoneOffset() * 60000;
    startInput.value = (new Date(start - tzOffset)).toISOString().split('T')[0];
    
    fetchRevenueData();
}

// Khởi tạo mặc định là 7 ngày qua
window.onload = () => {
    setQuickFilter('7days');
};

// Tính toán phần trăm so sánh
function renderComparison(elementId, current, previous) {
    const el = document.getElementById(elementId);
    if (previous === 0) {
        el.innerHTML = current > 0 ? `<span class="comp-up">▲ Tăng 100% so với cùng kỳ</span>` : `<span class="comp-flat">- Không đổi</span>`;
        return;
    }
    const diff = current - previous;
    const percent = Math.abs((diff / previous) * 100).toFixed(1);
    
    if (diff > 0) el.innerHTML = `<span class="comp-up">▲ Tăng ${percent}% so với cùng kỳ</span>`;
    else if (diff < 0) el.innerHTML = `<span class="comp-down">▼ Giảm ${percent}% so với cùng kỳ</span>`;
    else el.innerHTML = `<span class="comp-flat">- Không đổi so với cùng kỳ</span>`;
}

// Lấy và xử lý dữ liệu doanh thu
// Bảng giá nước để tính toán
const DRINK_PRICES = { nuoc_suoi: 10000, nuoc_ngot: 20000, bia: 20000, mi_tom: 30000 };

// Lấy và xử lý dữ liệu doanh thu
async function fetchRevenueData() {
    const startVal = document.getElementById('filterStart').value;
    const endVal = document.getElementById('filterEnd').value;
    if (!startVal || !endVal) return;

    // Ép giờ bắt đầu từ 00:00:00 và kết thúc ở 23:59:59 theo giờ local của máy
    const startStr = startVal + 'T00:00:00';
    const endStr = endVal + 'T23:59:59';

    // Tính số ngày để lùi chu kỳ trước so sánh
    const currentStart = new Date(startVal);
    const currentEnd = new Date(endVal);
    const diffTime = Math.abs(currentEnd - currentStart);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    
    const prevEnd = new Date(currentStart);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - diffDays + 1);

    const prevStartStr = prevStart.toISOString().split('T')[0] + 'T00:00:00';
    const prevEndStr = prevEnd.toISOString().split('T')[0] + 'T23:59:59';

    try {
        // Query dữ liệu kỳ hiện tại
        const { data: currentData, error: err1 } = await supabaseClient
            .from('bookings')
            .select('check_out_time, total_paid, surcharge, discount, items')
            .eq('status', 'completed')
            .gte('check_out_time', startStr)
            .lte('check_out_time', endStr);
            
        // Query dữ liệu kỳ trước để so sánh
        const { data: prevData, error: err2 } = await supabaseClient
            .from('bookings')
            .select('total_paid, surcharge, discount, items')
            .eq('status', 'completed')
            .gte('check_out_time', prevStartStr)
            .lte('check_out_time', prevEndStr);

        if (err1 || err2) throw err1 || err2;

        let curTotal = 0, curRoom = 0, curDrink = 0, curSurcharge = 0, curDiscount = 0;
        let dailyRevenue = {}; 

        currentData.forEach(b => {
            let total = Number(b.total_paid) || 0;
            let sur = Number(b.surcharge) || 0;
            let disc = Number(b.discount) || 0;
            
            let drink = 0;
            if (b.items) {
                for (let key in b.items) {
                    if (b.items[key] > 0) drink += b.items[key] * (DRINK_PRICES[key] || 0);
                }
            }
            
            let room = total - drink - sur + disc;
            if (room < 0) room = 0;

            curTotal += total;
            curRoom += room;
            curDrink += drink;
            curSurcharge += sur;
            curDiscount += disc;

            // Cắt lấy chuỗi ngày YYYY-MM-DD từ check_out_time
            let dateKey = b.check_out_time.substring(0, 10);
            dailyRevenue[dateKey] = (dailyRevenue[dateKey] || 0) + total;
        });

        let prevTotal = 0, prevRoom = 0, prevDrink = 0, prevSurcharge = 0, prevDiscount = 0;
        prevData.forEach(b => {
            let total = Number(b.total_paid) || 0;
            let sur = Number(b.surcharge) || 0;
            let disc = Number(b.discount) || 0;

            let drink = 0;
            if (b.items) {
                for (let key in b.items) {
                    if (b.items[key] > 0) drink += b.items[key] * (DRINK_PRICES[key] || 0);
                }
            }
            
            let room = total - drink - sur + disc;
            if (room < 0) room = 0;

            prevTotal += total;
            prevRoom += room;
            prevDrink += drink;
            prevSurcharge += sur;
            prevDiscount += disc;
        });

        // Render Cards
        document.getElementById('valTotalRev').innerText = fmtMoney(curTotal);
        document.getElementById('valRoomRev').innerText = fmtMoney(curRoom);
        document.getElementById('valDrinkRev').innerText = fmtMoney(curDrink);
        document.getElementById('valSurcharge').innerText = fmtMoney(curSurcharge);
        document.getElementById('valDiscount').innerText = fmtMoney(curDiscount);

        renderComparison('compTotalRev', curTotal, prevTotal);
        renderComparison('compRoomRev', curRoom, prevRoom);
        renderComparison('compDrinkRev', curDrink, prevDrink);
        renderComparison('compSurcharge', curSurcharge, prevSurcharge);
        renderComparison('compDiscount', curDiscount, prevDiscount);

        drawChart(dailyRevenue, currentStart, currentEnd);

    } catch (err) { console.error('Lỗi lấy data doanh thu:', err.message); }
}

function drawChart(dailyRevenue, startDate, endDate) {
    const ctx = document.getElementById('revenueChart').getContext('2d');
    
    // Tạo mảng các ngày trong khoảng
    let labels = [];
    let dataPoints = [];
    let curr = new Date(startDate);
    
    while (curr <= endDate) {
        let dateStr = curr.toISOString().split('T')[0];
        let displayStr = dateStr.split('-').reverse().slice(0,2).join('/'); // DD/MM
        labels.push(displayStr);
        dataPoints.push(dailyRevenue[dateStr] || 0);
        curr.setDate(curr.getDate() + 1);
    }

    if (revenueChartInstance) revenueChartInstance.destroy();

    revenueChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Tổng thu trong ngày',
                data: dataPoints,
                backgroundColor: 'rgba(0, 123, 255, 0.5)',
                borderColor: 'rgba(0, 123, 255, 1)',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#fff' } },
                tooltip: {
                    callbacks: { label: (ctx) => fmtMoney(ctx.raw) }
                }
            },
            scales: {
                y: { 
                    beginAtZero: true, 
                    ticks: { color: '#aaa', callback: (val) => val.toLocaleString() + 'đ' },
                    grid: { color: '#333' }
                },
                x: { 
                    ticks: { color: '#aaa' },
                    grid: { display: false }
                }
            }
        }
    });
}

// =====================================================================
// QUẢN LÝ CHI PHÍ KHÁCH SẠN
// =====================================================================

// Khởi tạo giá trị mặc định khi load trang
window.addEventListener('DOMContentLoaded', () => {
    const now = new Date();
    const yearMonth = now.toISOString().slice(0, 7); // 'YYYY-MM'
    const todayStr = now.toISOString().split('T')[0];

    document.getElementById('expDate').value = todayStr;
    document.getElementById('expMonthTarget').value = yearMonth;
    document.getElementById('filterStatsMonth').value = yearMonth;
    document.getElementById('filterListMonth').value = yearMonth;

    // Load data chi phí lần đầu
    fetchExpenseData();
});

// Xử lý hiện ô nhập "Khác"
function handleCategoryChange() {
    const val = document.getElementById('expCategory').value;
    document.getElementById('customCategoryGroup').style.display = (val === 'Khác') ? 'block' : 'none';
}

// Thêm chi phí mới vào Supabase
async function submitExpense() {
    const date = document.getElementById('expDate').value;
    let category = document.getElementById('expCategory').value;
    if (category === 'Khác') {
        category = document.getElementById('expCustomCategory').value.trim();
        if (!category) { alert('Vui lòng nhập tên loại chi phí khác!'); return; }
    }
    const amount = parseFloat(document.getElementById('expAmount').value) || 0;
    const targetMonth = document.getElementById('expMonthTarget').value;
    const description = document.getElementById('expDescription').value;

    if (!date || amount <= 0 || !targetMonth) {
        alert('Vui lòng điền đầy đủ ngày, số tiền hợp lệ và tháng ghi nhận!');
        return;
    }

    try {
        const { error } = await supabaseClient.from('expenses').insert([{
            expense_date: date,
            category: category,
            amount: amount,
            target_month: targetMonth,
            description: description
        }]);

        if (error) throw error;

        alert('Thêm chi phí thành công!');
        // Reset form cơ bản
        document.getElementById('expAmount').value = '';
        document.getElementById('expDescription').value = '';
        document.getElementById('expCustomCategory').value = '';
        
        fetchExpenseData(); // Load lại bảng
    } catch (err) {
        alert('Lỗi thêm chi phí: ' + err.message);
    }
}

// Lấy và render dữ liệu chi phí (Thống kê + Danh sách)
async function fetchExpenseData() {
    const statsMonth = document.getElementById('filterStatsMonth').value; // 'YYYY-MM'
    const listMonth = document.getElementById('filterListMonth').value;

    // Tính tháng trước của statsMonth để so sánh
    let [sYear, sMonth] = statsMonth.split('-').map(Number);
    let prevDate = new Date(sYear, sMonth - 2, 1); // JS month 0-indexed
    let prevMonthStr = `${prevDate.getFullYear()}-${(prevDate.getMonth() + 1).toString().padStart(2, '0')}`;

    try {
        // Query chi phí tháng hiện tại chọn & tháng trước
        const { data: expensesData, error } = await supabaseClient
            .from('expenses')
            .select('*')
            .or(`target_month.eq.${statsMonth},target_month.eq.${prevMonthStr}`)
            .order('expense_date', { ascending: false });

        if (error) throw error;

        let currentMonthExpenses = expensesData.filter(e => e.target_month === statsMonth);
        let prevMonthExpenses = expensesData.filter(e => e.target_month === prevMonthStr);

        // --- 1. RENDER THỐNG KÊ THEO LOẠI & SO SÁNH ---
        let totalCurrent = 0;
        let catCurrentMap = {};
        currentMonthExpenses.forEach(e => {
            totalCurrent += Number(e.amount) || 0;
            catCurrentMap[e.category] = (catCurrentMap[e.category] || 0) + (Number(e.amount) || 0);
        });

        let catPrevMap = {};
        prevMonthExpenses.forEach(e => {
            catPrevMap[e.category] = (catPrevMap[e.category] || 0) + (Number(e.amount) || 0);
        });

        document.getElementById('totalExpenseVal').innerText = fmtMoney(totalCurrent);

        let statsHtml = '';
        let allCategories = [...new Set([...Object.keys(catCurrentMap), ...Object.keys(catPrevMap)])];

        if (allCategories.length === 0) {
            statsHtml = `<tr><td colspan="3" style="text-align:center; color:#888;">Không có dữ liệu chi phí.</td></tr>`;
        } else {
            allCategories.forEach(cat => {
                let cur = catCurrentMap[cat] || 0;
                let prev = catPrevMap[cat] || 0;
                let diffHTML = '';

                if (prev === 0) {
                    diffHTML = `<span style="color:#00ff99;">Mới phát sinh</span>`;
                } else {
                    let diff = cur - prev;
                    let percent = Math.abs((diff / prev) * 100).toFixed(1);
                    if (diff > 0) diffHTML = `<span style="color:#ff4d4d;">▲ Tăng ${percent}%</span>`;
                    else if (diff < 0) diffHTML = `<span style="color:#00ff99;">▼ Giảm ${percent}%</span>`;
                    else diffHTML = `<span style="color:#aaa;">Không đổi</span>`;
                }

                statsHtml += `
                    <tr>
                        <td style="padding: 8px;"><b>${cat}</b></td>
                        <td style="padding: 8px; text-align: right; color: #ffc107;">${fmtMoney(cur)}</td>
                        <td style="padding: 8px; text-align: right;">${diffHTML}</td>
                    </tr>
                `;
            });
        }
        document.getElementById('expenseCategoryStatsBody').innerHTML = statsHtml;

        // --- 2. RENDER DANH SÁCH CHI PHÍ (THEO `listMonth`) ---
        // Lấy riêng danh sách cho listMonth
        const { data: listData, error: listErr } = await supabaseClient
            .from('expenses')
            .select('*')
            .eq('target_month', listMonth)
            .order('expense_date', { ascending: false });

        if (listErr) throw listErr;

        let listHtml = '';
        if (listData.length === 0) {
            listHtml = `<tr><td colspan="6" style="text-align:center; color:#888;">Không có bản ghi chi phí nào trong tháng ${listMonth}.</td></tr>`;
        } else {
            listData.forEach(item => {
                const formattedDate = new Date(item.expense_date).toLocaleDateString('vi-VN');
                listHtml += `
                    <tr>
                        <td style="padding: 10px;">${formattedDate}</td>
                        <td style="padding: 10px;"><b>${item.category}</b></td>
                        <td style="padding: 10px; color: #ccc;">${item.description || '-'}</td>
                        <td style="padding: 10px;">${item.target_month}</td>
                        <td style="padding: 10px; text-align: right; color: #ff4d4d; font-weight: bold;">${fmtMoney(item.amount)}</td>
                        <td style="padding: 10px; text-align: center;">
                            <button class="btn-edit-expense" onclick='openEditExpenseModal(${JSON.stringify(item)})'>Sửa</button>
                            <button style="background: #dc3545; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer;" onclick="deleteExpense(${item.id})">Xóa</button>
                        </td>
                    </tr>
                `;
            });
        }
        document.getElementById('expenseListBody').innerHTML = listHtml;

    } catch (err) {
        console.error('Lỗi tải dữ liệu chi phí:', err.message);
    }
}

// Xóa khoản chi phí
async function deleteExpense(id) {
    if (!confirm('Bạn có chắc chắn muốn xóa khoản chi phí này không?')) return;
    try {
        const { error } = await supabaseClient.from('expenses').delete().eq('id', id);
        if (error) throw error;
        fetchExpenseData();
    } catch (err) {
        alert('Lỗi khi xóa: ' + err.message);
    }
}

// =====================================================================
// TÍNH NĂNG SỬA CHI PHÍ
// =====================================================================

// Mở modal sửa và điền sẵn thông tin cũ
function openEditExpenseModal(item) {
    document.getElementById('editExpId').value = item.id;
    document.getElementById('editExpDate').value = item.expense_date;
    document.getElementById('editExpCategory').value = item.category;
    document.getElementById('editExpAmount').value = item.amount;
    document.getElementById('editExpMonthTarget').value = item.target_month;
    document.getElementById('editExpDescription').value = item.description || '';

    document.getElementById('editExpenseModal').style.display = 'flex';
}

function closeEditExpenseModal() {
    document.getElementById('editExpenseModal').style.display = 'none';
}

// Lưu thông tin sau khi sửa vào Supabase
async function submitEditExpense() {
    const id = document.getElementById('editExpId').value;
    const date = document.getElementById('editExpDate').value;
    const category = document.getElementById('editExpCategory').value;
    const amount = parseFloat(document.getElementById('editExpAmount').value) || 0;
    const targetMonth = document.getElementById('editExpMonthTarget').value;
    const description = document.getElementById('editExpDescription').value;

    if (!date || amount <= 0 || !targetMonth) {
        alert('Vui lòng điền đầy đủ thông tin hợp lệ!');
        return;
    }

    try {
        const { error } = await supabaseClient.from('expenses').update({
            expense_date: date,
            category: category,
            amount: amount,
            target_month: targetMonth,
            description: description
        }).eq('id', id);

        if (error) throw error;

        closeEditExpenseModal();
        alert('Cập nhật chi phí thành công!');
        fetchExpenseData(); // Load lại bảng danh sách và thống kê
    } catch (err) {
        alert('Lỗi cập nhật: ' + err.message);
    }
}

// =====================================================================
// QUẢN LÝ KHÁCH HÀNG & LỊCH SỬ (LOCAL FILTER MƯỢT MÀ)
// =====================================================================

let allCustomersData = [];

document.addEventListener("DOMContentLoaded", () => {
    const originalSwitch = window.switchAdminTab;
    if (originalSwitch) {
        window.switchAdminTab = function(tabId, element) {
            originalSwitch(tabId, element);
            if (tabId === 'tabCustomer') fetchCustomersData();
        };
    }
});

// Tải sẵn danh sách khách hàng khi vào tab
async function fetchCustomersData() {
    try {
        // 1. Lấy tổng số lượng chuẩn chính xác bằng count()
        const { count, error: countErr } = await supabaseClient
            .from('customers')
            .select('*', { count: 'exact', head: true });

        if (countErr) throw countErr;
        document.getElementById('statTotalCust').innerText = count || 0;

        // 2. Lấy danh sách khách hàng (Lấy tối đa 1000 bản ghi gần nhất để search cho nhanh và mượt)
        const { data, error } = await supabaseClient
            .from('customers')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1000);

        if (error) throw error;
        allCustomersData = data || [];
        
        // Tính toán KPI tháng này và khách quen
        updateCustomerKPIs(allCustomersData);

        // Reset bảng trống ban đầu
        document.getElementById('customerTableBody').innerHTML = `<tr><td colspan="6" style="text-align: center; color: #888; padding: 30px;">Nhập tên hoặc số CCCD vào ô tìm kiếm bên trên để tra cứu khách hàng...</td></tr>`;

    } catch (err) {
        console.error('Lỗi tải dữ liệu khách hàng:', err.message);
    }
}

// Cập nhật thẻ KPI tổng quan
function updateCustomerKPIs(customers) {
    const now = new Date();
    const currentMonthPrefix = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
    
    let newMonthCount = 0;
    let returningCount = 0;

    customers.forEach(c => {
        if (c.created_at && c.created_at.startsWith(currentMonthPrefix)) {
            newMonthCount++;
        }
        if ((c.stay_count || 1) > 1) {
            returningCount++;
        }
    });

    document.getElementById('statNewCustMonth').innerText = newMonthCount;
    document.getElementById('statReturningCust').innerText = returningCount;
}

// Hàm lọc trực tiếp trên mảng JS (Không sợ lệch dấu, viết hoa/thường)
function filterCustomerTable() {
    const keyword = document.getElementById('custSearchInput').value.trim().toLowerCase();
    const tbody = document.getElementById('customerTableBody');

    if (!keyword || keyword.length < 2) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #888; padding: 30px;">Nhập từ khóa (tối thiểu 2 ký tự) để tìm kiếm khách hàng...</td></tr>`;
        return;
    }

    // Lọc local cực nhanh
    const filtered = allCustomersData.filter(c => {
        const name = (c.guest_name || '').toLowerCase();
        const cccd = (c.guest_cccd || '').toLowerCase();
        return name.includes(keyword) || cccd.includes(keyword);
    });

    renderCustomerTable(filtered);
}

// Render bảng danh sách khách hàng
function renderCustomerTable(customers) {
    const tbody = document.getElementById('customerTableBody');
    let html = '';

    if (customers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #888; padding: 20px;">Không tìm thấy khách hàng nào khớp với từ khóa.</td></tr>`;
        return;
    }

    customers.forEach(c => {
        let stayCount = c.stay_count || 1;
        const dob = c.guest_dob ? new Date(c.guest_dob).toLocaleDateString('vi-VN') : '-';
        const addressFull = [c.address_detail, c.ward, c.district, c.province].filter(Boolean).join(', ') || '-';

        html += `
            <tr style="border-bottom: 1px solid #333;">
                <td style="padding: 12px 15px;"><b>${c.guest_name || 'Khách lẻ'}</b></td>
                <td style="padding: 12px 15px; color: #00ff99; white-space: nowrap;">${c.guest_cccd || 'Không có'}</td>
                <td style="padding: 12px 15px; white-space: nowrap;">${dob}</td>
                <td style="padding: 12px 15px; color: #ccc; font-size: 13px;">${addressFull}</td>
                <td style="padding: 12px 15px; text-align: center; font-weight: bold; color: #ffc107;">${stayCount}</td>
                <td style="padding: 12px 15px; text-align: center; white-space: nowrap;">
                    <button class="btn-action-view" style="padding: 4px 8px; font-size: 12px;" onclick="openCustomerHistory('${c.id}', '${c.guest_name || 'Khách'}')">Lịch sử</button>
                    <button class="btn-action-edit" style="padding: 4px 8px; font-size: 12px;" onclick='openEditCustomerModal(${JSON.stringify(c)})'>Sửa</button>
                    <button class="btn-action-del" style="padding: 4px 8px; font-size: 12px;" onclick="deleteCustomer('${c.id}')">Xóa</button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

// Hàm lọc trực tiếp trên mảng JS (Đã fix lỗi xóa text mà data vẫn còn & tối ưu hiển thị nút)
function filterCustomerTable() {
    const keyword = document.getElementById('custSearchInput').value.trim().toLowerCase();
    const tbody = document.getElementById('customerTableBody');

    // Nếu ô tìm kiếm trống hoàn toàn hoặc dưới 2 ký tự -> Dọn sạch bảng về trạng thái ban đầu
    if (!keyword || keyword.length < 2) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #888; padding: 30px;">Nhập từ khóa (tối thiểu 2 ký tự) để tìm kiếm khách hàng...</td></tr>`;
        return;
    }

    // Lọc local cực nhanh
    const filtered = allCustomersData.filter(c => {
        const name = (c.guest_name || '').toLowerCase();
        const cccd = (c.guest_cccd || '').toLowerCase();
        return name.includes(keyword) || cccd.includes(keyword);
    });

    renderCustomerTable(filtered);
}

// --- 1. XEM LỊCH SỬ LƯU TRÚ ---
async function openCustomerHistory(customerId, customerName) {
    document.getElementById('custHistoryTitle').innerText = `Lịch sử lưu trú của: ${customerName}`;
    const tbody = document.getElementById('customerHistoryBody');
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #aaa; padding: 20px;">Đang tải lịch sử...</td></tr>`;
    document.getElementById('customerHistoryModal').style.display = 'flex';

    try {
        const { data: bookings, error } = await supabaseClient
            .from('bookings')
            .select('*, rooms (room_name)')
            .eq('customer_id', customerId)
            .eq('status', 'completed')
            .order('check_out_time', { ascending: false }); // Sắp xếp từ mới đến cũ

        if (error) throw error;

        if (!bookings || bookings.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #888; padding: 20px;">Khách hàng chưa có lịch sử trả phòng nào.</td></tr>`;
            return;
        }

        let html = '';
        bookings.forEach(b => {
            const roomName = b.rooms ? b.rooms.room_name : 'N/A';
            let typeName = 'Theo giờ';
            if (b.price_type === 'overnight') typeName = 'Qua đêm';
            if (b.price_type === 'daily') typeName = 'Ngày đêm';

            const checkIn = new Date(b.check_in_time).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
            const checkOut = new Date(b.check_out_time).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
            const totalPaid = Number(b.total_paid) || 0;

            html += `
                <tr style="border-bottom: 1px solid #333;">
                    <td style="padding: 10px;"><b>Phòng ${roomName}</b></td>
                    <td style="padding: 10px;">${typeName}</td>
                    <td style="padding: 10px; font-size: 13px;">${checkIn}</td>
                    <td style="padding: 10px; font-size: 13px;">${checkOut}</td>
                    <td style="padding: 10px; text-align: right; color: #00ff99; font-weight: bold;">${totalPaid.toLocaleString()}đ</td>
                </tr>
            `;
        });
        tbody.innerHTML = html;

    } catch (err) {
        console.error('Lỗi lấy lịch sử khách:', err.message);
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: red; padding: 20px;">Lỗi tải lịch sử khách hàng.</td></tr>`;
    }
}

function closeCustomerHistoryModal() {
    document.getElementById('customerHistoryModal').style.display = 'none';
}

// --- 2. SỬA THÔNG TIN KHÁCH HÀNG ---
function openEditCustomerModal(c) {
    document.getElementById('editCustId').value = c.id;
    document.getElementById('editCustName').value = c.guest_name || '';
    document.getElementById('editCustCCCD').value = c.guest_cccd || '';
    document.getElementById('editCustDob').value = c.guest_dob || '';
    document.getElementById('editCustAddress').value = c.address_detail || '';
    document.getElementById('editCustWard').value = c.ward || '';
    document.getElementById('editCustDistrict').value = c.district || '';
    document.getElementById('editCustProvince').value = c.province || '';

    document.getElementById('editCustomerModal').style.display = 'flex';
}

function closeEditCustomerModal() {
    document.getElementById('editCustomerModal').style.display = 'none';
}

async function submitEditCustomer() {
    const id = document.getElementById('editCustId').value;
    const name = document.getElementById('editCustName').value.trim();
    if (!name) { alert('Vui lòng nhập tên khách hàng!'); return; }

    const payload = {
        guest_name: name,
        guest_cccd: document.getElementById('editCustCCCD').value.trim(),
        guest_dob: document.getElementById('editCustDob').value || null,
        address_detail: document.getElementById('editCustAddress').value.trim(),
        ward: document.getElementById('editCustWard').value.trim(),
        district: document.getElementById('editCustDistrict').value.trim(),
        province: document.getElementById('editCustProvince').value.trim()
    };

    try {
        const { error } = await supabaseClient.from('customers').update(payload).eq('id', id);
        if (error) throw error;

        closeEditCustomerModal();
        alert('Cập nhật thông tin khách hàng thành công!');
        fetchCustomersData();
    } catch (err) {
        alert('Lỗi cập nhật: ' + err.message);
    }
}

// --- 3. XÓA KHÁCH HÀNG ---
async function deleteCustomer(id) {
    if (!confirm('Bạn có chắc chắn muốn xóa khách hàng này không?')) return;
    try {
        const { error } = await supabaseClient.from('customers').delete().eq('id', id);
        if (error) throw error;
        alert('Xóa khách hàng thành công!');
        fetchCustomersData();
    } catch (err) {
        alert('Lỗi khi xóa: ' + err.message);
    }
}

// Thêm khách hàng thủ công nhanh
function openAddCustomerModal() {
    // Ta tận dụng lại modal sửa nhưng reset trắng để thêm mới
    document.getElementById('editCustId').value = '';
    document.getElementById('editCustName').value = '';
    document.getElementById('editCustCCCD').value = '';
    document.getElementById('editCustDob').value = '';
    document.getElementById('editCustAddress').value = '';
    document.getElementById('editCustWard').value = '';
    document.getElementById('editCustDistrict').value = '';
    document.getElementById('editCustProvince').value = '';
    document.getElementById('editCustomerModal').style.display = 'flex';
}

// Ghi đè hàm submitEditCustomer để hỗ trợ cả Thêm mới nếu id trống
const originalSubmitEditCustomer = submitEditCustomer;
window.submitEditCustomer = async function() {
    const id = document.getElementById('editCustId').value;
    if (!id) {
        // Trường hợp Thêm mới
        const name = document.getElementById('editCustName').value.trim();
        if (!name) { alert('Vui lòng nhập tên khách hàng!'); return; }
        const payload = {
            guest_name: name,
            guest_cccd: document.getElementById('editCustCCCD').value.trim(),
            guest_dob: document.getElementById('editCustDob').value || null,
            address_detail: document.getElementById('editCustAddress').value.trim(),
            ward: document.getElementById('editCustWard').value.trim(),
            district: document.getElementById('editCustDistrict').value.trim(),
            province: document.getElementById('editCustProvince').value.trim(),
            stay_count: 1
        };
        try {
            const { error } = await supabaseClient.from('customers').insert([payload]);
            if (error) throw error;
            closeEditCustomerModal();
            alert('Thêm khách hàng thành công!');
            fetchCustomersData();
        } catch (err) {
            alert('Lỗi thêm khách: ' + err.message);
        }
    } else {
        originalSubmitEditCustomer();
    }
};

// =====================================================================
// CÀI ĐẶT GIÁ PHÒNG & ĐỒ UỐNG (ADMIN DASHBOARD)
// =====================================================================

// Lắng nghe sự kiện chuyển tab để tự động load cài đặt khi bấm sang tab Settings
document.addEventListener("DOMContentLoaded", () => {
    const originalSwitch = window.switchAdminTab;
    if (originalSwitch) {
        window.switchAdminTab = function(tabId, element) {
            originalSwitch(tabId, element);
            if (tabId === 'tabSettings') fetchSettingsData();
        };
    }
});

// Hàm định nghĩa chính thức để load dữ liệu cài đặt giá đồ uống và giá từng phòng
async function fetchSettingsData() {
    try {
        // 1. Load giá đồ uống từ bảng hotel_settings
        const { data: settingsData, error: err1 } = await supabaseClient.from('hotel_settings').select('*');
        if (err1) throw err1;

        if (settingsData) {
            settingsData.forEach(item => {
                const input = document.getElementById(`setting_${item.key}`);
                if (input) input.value = item.value;
            });
        }

        // 2. TỰ ĐỘNG lấy danh sách toàn bộ phòng từ bảng rooms để không bao giờ bị thiếu
        const { data: roomsList, error: errRooms } = await supabaseClient.from('rooms').select('room_name').order('room_name', { ascending: true });
        if (errRooms) throw errRooms;

        // 3. Load giá riêng từng phòng từ bảng room_pricing
        const { data: roomPricesData, error: err2 } = await supabaseClient.from('room_pricing').select('*');
        if (err2) throw err2;

        let configMap = {};
        if (roomPricesData) {
            roomPricesData.forEach(r => { configMap[r.room_name] = r; });
        }

        let html = '';
        // Duyệt qua danh sách phòng thực tế từ DB
        roomsList.forEach(room => {
            let roomName = room.room_name;
            let currentCfg = configMap[roomName] || { first_hour: '', overnight: '', daily: '' };
            html += `
                <tr style="border-bottom: 1px solid #333;" class="room-price-row" data-room="${roomName}">
                    <td style="padding: 10px;"><b>Phòng ${roomName}</b></td>
                    <td style="padding: 10px;"><input type="number" id="room_fh_${roomName}" value="${currentCfg.first_hour !== null && currentCfg.first_hour !== undefined ? currentCfg.first_hour : ''}" placeholder="Nhập giá..." style="width:100%; padding:6px; background:#2a2a2a; border:1px solid #444; color:#fff; border-radius:4px;"></td>
                    <td style="padding: 10px;"><input type="number" id="room_ov_${roomName}" value="${currentCfg.overnight !== null && currentCfg.overnight !== undefined ? currentCfg.overnight : ''}" placeholder="Nhập giá..." style="width:100%; padding:6px; background:#2a2a2a; border:1px solid #444; color:#fff; border-radius:4px;"></td>
                    <td style="padding: 10px;"><input type="number" id="room_da_${roomName}" value="${currentCfg.daily !== null && currentCfg.daily !== undefined ? currentCfg.daily : ''}" placeholder="Nhập giá..." style="width:100%; padding:6px; background:#2a2a2a; border:1px solid #444; color:#fff; border-radius:4px;"></td>
                </tr>
            `;
        });
        const tbody = document.getElementById('roomSpecificPricingBody');
        if (tbody) tbody.innerHTML = html;

    } catch (err) {
        console.error('Lỗi tải cài đặt giá:', err.message);
    }
}

// Hàm lưu toàn bộ cài đặt (Đã bỏ giá chung, chỉ lưu đồ uống và giá từng phòng)
async function saveAllSettings() {
    const drinkKeys = ['drink_nuoc_suoi', 'drink_nuoc_ngot', 'drink_bia', 'drink_mi_tom'];

    try {
        // 1. Lưu cài đặt đồ uống
        for (let key of drinkKeys) {
            const input = document.getElementById(`setting_${key}`);
            if (!input) continue;
            let val = parseFloat(input.value) || 0;

            const { error } = await supabaseClient
                .from('hotel_settings')
                .upsert({ key: key, value: val });

            if (error) throw error;
        }

        // 2. Lưu cài đặt giá riêng từng phòng quét từ DOM
        const roomRows = document.querySelectorAll('.room-price-row');
        for (let row of roomRows) {
            let roomName = row.getAttribute('data-room');
            let fhInput = document.getElementById(`room_fh_${roomName}`);
            let ovInput = document.getElementById(`room_ov_${roomName}`);
            let daInput = document.getElementById(`room_da_${roomName}`);

            if (!fhInput || !ovInput || !daInput) continue;

            let fh = parseFloat(fhInput.value);
            let ov = parseFloat(ovInput.value);
            let da = parseFloat(daInput.value);

            if (isNaN(fh) && isNaN(ov) && isNaN(da)) {
                await supabaseClient.from('room_pricing').delete().eq('room_name', roomName);
            } else {
                await supabaseClient.from('room_pricing').upsert({
                    room_name: roomName,
                    first_hour: isNaN(fh) ? null : fh,
                    overnight: isNaN(ov) ? null : ov,
                    daily: isNaN(da) ? null : da
                });
            }
        }

        alert('Lưu thay đổi cài đặt giá thành công!');
        fetchSettingsData();
    } catch (err) {
        alert('Lỗi khi lưu cài đặt: ' + err.message);
    }
}