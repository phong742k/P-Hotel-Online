const SUPABASE_URL = 'https://wohnxhepcaqxyzrgjbrj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndvaG54aGVwY2FxeHl6cmdqYnJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwNzE4MjgsImV4cCI6MjEwNTY0NzgyOH0.KvQXewy2kBRwGJB8treP2QFu6Cj6maVGxSRYlhoGTAw'; // DÁN LẠI KEY CỦA MÀY

let supabaseClient = null;
if (window.supabase) supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let roomsData = [];
const layout = { left: ['Tầng G', 'Tầng 1', 'Tầng 2'], right: ['Tầng 5', 'Tầng 3', 'Tầng 4'] };

let currentDrinks = { nuoc_suoi: 0, nuoc_ngot: 0, bia: 0, mi_tom: 0 };
let updateDrinks = { nuoc_suoi: 0, nuoc_ngot: 0, bia: 0, mi_tom: 0 };
let selectedRoomId = null;
let currentActiveBooking = null;
let selectedCustomerId = null; 
let selectedUpdateCustomerId = null; 

let dynamicSettings = {};
let roomPricingConfig = {};
let DRINK_PRICES = { nuoc_suoi: 10000, nuoc_ngot: 20000, bia: 20000, mi_tom: 30000 };

async function loadSystemSettings() {
    if (!supabaseClient) return;
    try {
        const { data: settingsData } = await supabaseClient.from('hotel_settings').select('*');
        if (settingsData) {
            settingsData.forEach(item => {
                dynamicSettings[item.key] = Number(item.value);
            });
            if (dynamicSettings['drink_nuoc_suoi']) DRINK_PRICES.nuoc_suoi = dynamicSettings['drink_nuoc_suoi'];
            if (dynamicSettings['drink_nuoc_ngot']) DRINK_PRICES.nuoc_ngot = dynamicSettings['drink_nuoc_ngot'];
            if (dynamicSettings['drink_bia']) DRINK_PRICES.bia = dynamicSettings['drink_bia'];
            if (dynamicSettings['drink_mi_tom']) DRINK_PRICES.mi_tom = dynamicSettings['drink_mi_tom'];
        }

        const { data: roomPricesData } = await supabaseClient.from('room_pricing').select('*');
        if (roomPricesData) {
            roomPricesData.forEach(item => {
                roomPricingConfig[item.room_name] = {
                    first_hour: item.first_hour,
                    overnight: item.overnight,
                    daily: item.daily
                };
            });
        }
    } catch (err) {
        console.error('Lỗi đồng bộ giá từ hệ thống:', err);
    }
}

async function fetchRoomsFromSupabase() {
    try {
        const { data: rooms, error } = await supabaseClient
            .from('rooms')
            .select(`*, bookings (id, status, price_type, items, prepaid_cash, prepaid_transfer, check_in_time, notes, customer_id, customers (id, guest_name, guest_cccd, guest_dob, address_detail, ward, district, province))`)
            .order('id', { ascending: true });

        if (error) throw error;

        roomsData = rooms.map(room => {
            const activeBooking = room.bookings ? room.bookings.find(b => b.status === 'active') : null;
            let floorName = 'Tầng G';
            if (room.room_name.startsWith('1')) floorName = 'Tầng 1';
            else if (room.room_name.startsWith('2')) floorName = 'Tầng 2';
            else if (room.room_name.startsWith('3')) floorName = 'Tầng 3';
            else if (room.room_name.startsWith('4')) floorName = 'Tầng 4';
            else if (room.room_name.startsWith('5')) floorName = 'Tầng 5';

            return {
                id: room.id, name: room.room_name, floor: floorName,
                first_hour_price: room.first_hour_price, status: room.status,
                activeBooking: activeBooking
            };
        });
        renderDashboard();
    } catch (err) { console.error('Lỗi tải data:', err.message); }
}

function calculateRoomPricing(room, checkInStr, pType, checkOutDate) {
    const checkIn = new Date(checkInStr);
    const checkOut = checkOutDate || new Date();

    // Lấy giá động cho từng phòng. Fallback giá chung nếu phòng chưa cài đặt
    const roomCfg = roomPricingConfig[room.name] || {};
    let baseFirstHour = roomCfg.first_hour ? Number(roomCfg.first_hour) : 80000;
    let baseNightPrice = roomCfg.overnight ? Number(roomCfg.overnight) : 200000;
    let baseDayNightPrice = roomCfg.daily ? Number(roomCfg.daily) : 300000;

    let roomPrice = 0;
    let breakdownHTML = '';

    if (pType === 'hourly') {
        let diffMins = Math.floor((checkOut - checkIn) / 60000);
        let hours = 0;
        if (diffMins > 15) { // Ân hạn 15 phút
            hours = Math.floor((diffMins - 15) / 60) + 1;
        }
        if (hours < 1) hours = 1; // Tối thiểu 1h

        if (hours === 1) {
            roomPrice = baseFirstHour;
            breakdownHTML += `<div class="checkout-row"><span>Tiền phòng (1 giờ đầu):</span> <b>${roomPrice.toLocaleString()}đ</b></div>`;
        } else if (hours === 2) {
            roomPrice = baseFirstHour + 20000;
            breakdownHTML += `<div class="checkout-row"><span>Tiền phòng (2 giờ):</span> <b>${roomPrice.toLocaleString()}đ</b></div>`;
        } else {
            roomPrice = baseFirstHour + 20000 + (hours - 2) * 10000;
            breakdownHTML += `<div class="checkout-row"><span>Tiền phòng (${hours} giờ):</span> <b>${roomPrice.toLocaleString()}đ</b></div>`;
        }
    } else {
        let inHour = checkIn.getHours();

        // 1. TÍNH TIỀN GỐC LÚC NHẬN PHÒNG & PHỤ THU VÀO SỚM
        if (pType === 'daily') {
            if (inHour >= 0 && inHour < 12) {
                let target12h = new Date(checkIn);
                target12h.setHours(12, 0, 0, 0);
                let earlyHours = Math.ceil((target12h - checkIn) / (1000 * 60 * 60));
                roomPrice = baseDayNightPrice + (earlyHours * 20000);
                breakdownHTML += `<div class="checkout-row"><span>Ngày đêm (Gốc):</span> <b>${baseDayNightPrice.toLocaleString()}đ</b></div>`;
                breakdownHTML += `<div class="checkout-row"><span>Phụ thu nhận sớm (${earlyHours}h):</span> <b>+ ${(earlyHours * 20000).toLocaleString()}đ</b></div>`;
            } else {
                roomPrice = baseDayNightPrice;
                breakdownHTML += `<div class="checkout-row"><span>Ngày đêm (Gốc):</span> <b>${roomPrice.toLocaleString()}đ</b></div>`;
            }
        } else if (pType === 'overnight') {
            if (inHour >= 12 && inHour < 18) {
                let target18h = new Date(checkIn);
                target18h.setHours(18, 0, 0, 0);
                let earlyHours = Math.ceil((target18h - checkIn) / (1000 * 60 * 60));
                roomPrice = baseNightPrice + (earlyHours * 20000);
                breakdownHTML += `<div class="checkout-row"><span>Qua đêm (Gốc):</span> <b>${baseNightPrice.toLocaleString()}đ</b></div>`;
                breakdownHTML += `<div class="checkout-row"><span>Phụ thu nhận sớm (${earlyHours}h):</span> <b>+ ${(earlyHours * 20000).toLocaleString()}đ</b></div>`;
            } else {
                roomPrice = baseNightPrice;
                breakdownHTML += `<div class="checkout-row"><span>Qua đêm (Gốc):</span> <b>${roomPrice.toLocaleString()}đ</b></div>`;
            }
        }

        // 2. XÁC ĐỊNH MỐC TRẢ PHÒNG CHUẨN ĐẦU TIÊN
        let standardCheckout = new Date(checkIn);
        if (pType === 'overnight' && inHour >= 0 && inHour < 12) {
            standardCheckout.setHours(12, 0, 0, 0); // Nhận sau 0h sáng -> Trả 12h trưa cùng ngày
        } else {
            standardCheckout.setDate(standardCheckout.getDate() + 1);
            standardCheckout.setHours(12, 0, 0, 0); // Trả 12h trưa hôm sau
        }

        // 3. VÒNG LẶP TÍNH PHỤ THU QUÁ GIỜ HOẶC CỘNG DỒN NGÀY
        let extraDays = 0;
        let lateHours = 0;

        while (checkOut > standardCheckout) {
            let cutoff20h = new Date(standardCheckout);
            cutoff20h.setHours(20, 0, 0, 0); // Mốc 8h tối của ngày standardCheckout

            if (checkOut >= cutoff20h) {
                // Đã qua 8h tối -> Chốt thành 1 ngày đêm, tiếp tục xét vòng lặp
                extraDays++;
                standardCheckout.setDate(standardCheckout.getDate() + 1); // Dời mốc chuẩn sang 12h trưa hôm sau
            } else {
                // Trả trước 8h tối -> Tính lố giờ (ân hạn 15 phút)
                let diffMins = Math.floor((checkOut - standardCheckout) / 60000);
                if (diffMins > 15) {
                    lateHours = Math.floor((diffMins - 15) / 60) + 1;
                }
                break; // Xử lý xong, thoát vòng lặp
            }
        }

        // 4. ÁP GIÁ & IN RA HÓA ĐƠN
        if (extraDays > 0) {
            let extraDaysPrice = extraDays * baseDayNightPrice; // Tính bằng giá Ngày đêm
            roomPrice += extraDaysPrice;
            breakdownHTML += `<div class="checkout-row" style="color: #ffc107;"><span>Phòng ở thêm (${extraDays} ngày):</span> <b>+ ${extraDaysPrice.toLocaleString()}đ</b></div>`;
        }

        if (lateHours > 0) {
            let lateFee = lateHours * 20000;
            roomPrice += lateFee;
            breakdownHTML += `<div class="checkout-row" style="color: #ffc107;"><span>Phụ thu trả muộn (${lateHours}h):</span> <b>+ ${lateFee.toLocaleString()}đ</b></div>`;
        }
    }
    
    return { roomPrice, breakdownHTML };
}

function createRoomCard(room) {
    let cardClass = room.status === 'trong' ? 'status-trong' : (room.status === 'chuadon' ? 'status-chuadon' : 'status-cokhach');
    let innerHTML = `<h3>${room.name}</h3>`;

    if (room.status === 'trong') innerHTML += `<span>Sẵn sàng</span>`;
    else if (room.status === 'chuadon') innerHTML += `<span>Chưa dọn</span>`;
    else if (room.status === 'co_khach' && room.activeBooking) {
        let typeName = 'Theo giờ';
        if (room.activeBooking.price_type === 'overnight') typeName = 'Qua đêm';
        if (room.activeBooking.price_type === 'daily') typeName = 'Ngày đêm';
        
        let checkInTime = new Date(room.activeBooking.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let totalPrepaid = (Number(room.activeBooking.prepaid_cash) || 0) + (Number(room.activeBooking.prepaid_transfer) || 0);
        
        // Tính tiền phòng gốc
        let pricing = calculateRoomPricing(room, room.activeBooking.check_in_time, room.activeBooking.price_type, new Date());
        
        // Tính thêm tiền đồ uống
        let totalDrinkPrice = 0;
        if (room.activeBooking.items) {
            for (let key in room.activeBooking.items) {
                let qty = room.activeBooking.items[key];
                if (qty > 0) totalDrinkPrice += (qty * DRINK_PRICES[key]);
            }
        }

        // Tổng tạm tính = Tiền phòng + Tiền đồ uống
        let tempTotal = pricing.roomPrice + totalDrinkPrice;
        let tempPriceStr = tempTotal.toLocaleString() + 'đ';

        innerHTML += `
            <div class="room-info">
                <div><b>Loại:</b> ${typeName}</div>
                <div><b>Vào:</b> ${checkInTime}</div>
                <div><b>Tạm tính:</b> <span style="color: #fff15a; font-size: 16px; font-weight: bold;">${tempPriceStr}</span></div>
                <div><b>Đã thu:</b> ${totalPrepaid.toLocaleString()}đ</div>
            </div>`;
    }
    return `<div class="room-card ${cardClass}" onclick="handleRoomClick(${room.id}, '${room.name}', '${room.status}')">${innerHTML}</div>`;
}

function renderDashboard() {
    const colLeft = document.getElementById('col-left');
    const colRight = document.getElementById('col-right');
    if (!colLeft || !colRight) return;
    colLeft.innerHTML = ''; colRight.innerHTML = '';

    layout.left.forEach(floorName => {
        let rowHTML = `<div class="floor"><div class="floor-title">${floorName}</div><div class="room-row">`;
        roomsData.filter(r => r.floor === floorName).forEach(room => { rowHTML += createRoomCard(room); });
        colLeft.innerHTML += rowHTML + `</div></div>`;
    });
    layout.right.forEach(floorName => {
        let rowHTML = `<div class="floor"><div class="floor-title">${floorName}</div><div class="room-row">`;
        roomsData.filter(r => r.floor === floorName).forEach(room => { rowHTML += createRoomCard(room); });
        colRight.innerHTML += rowHTML + `</div></div>`;
    });
}

setInterval(async () => {
    await loadSystemSettings(); 
    fetchRoomsFromSupabase();
}, 3000);

function handleRoomClick(roomId, roomName, status) {
    selectedRoomId = roomId;
    const room = roomsData.find(r => r.id === roomId);

    if (status === 'trong') {
        document.getElementById('modalTitle').innerText = `Nhận Phòng - Phòng ${roomName}`;
        document.getElementById('checkinModal').style.display = 'flex';
        resetModalForm();
    } else if (status === 'co_khach') {
        currentActiveBooking = room.activeBooking;
        openUpdateModal(roomName);
    } else if (status === 'chuadon') {
        if(confirm(`Phòng ${roomName} đã dọn xong?`)) updateRoomStatusInSupabase(roomId, 'trong');
    }
}

// ---------------- TAB SWITCHING ----------------
function switchTab(tabId) {
    document.getElementById('btnTabDashboard').classList.remove('active');
    document.getElementById('btnTabHistory').classList.remove('active');
    
    document.getElementById('tabDashboard').style.display = 'none';
    document.getElementById('tabHistory').style.display = 'none';

    if (tabId === 'dashboard') {
        document.getElementById('btnTabDashboard').classList.add('active');
        document.getElementById('tabDashboard').style.display = 'flex';
        fetchRoomsFromSupabase();
    } else {
        document.getElementById('btnTabHistory').classList.add('active');
        document.getElementById('tabHistory').style.display = 'flex';
        fetchHistoryFromSupabase();
    }
}

// ---------------- LỊCH SỬ & BỘ LỌC (HIỂN THỊ DẠNG CỘT) ----------------
let historyData = [];

async function fetchHistoryFromSupabase() {
    try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const { data, error } = await supabaseClient
            .from('bookings')
            .select(`*, rooms (room_name), customers (guest_name)`)
            .eq('status', 'completed')
            .gte('check_out_time', sevenDaysAgo.toISOString())
            .order('check_out_time', { ascending: false });

        if (error) throw error;
        historyData = data; 
        filterHistory();
    } catch (err) {
        console.error('Lỗi lấy lịch sử:', err.message);
    }
}

function renderHistoryTable(data) {
    const tbody = document.getElementById('historyTableBody');
    tbody.innerHTML = '';
    document.getElementById('recordCount').innerText = data.length;
    document.getElementById('selectAllCheckbox').checked = false;

    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: #888;">Không có dữ liệu bản ghi phù hợp.</td></tr>`;
        return;
    }

    let html = '';
    data.forEach(item => {
        const roomName = item.rooms ? item.rooms.room_name : 'N/A';
        const guestName = item.customers ? item.customers.guest_name : 'Khách lẻ';
        
        let typeName = 'Theo giờ';
        if (item.price_type === 'overnight') typeName = 'Qua đêm';
        if (item.price_type === 'daily') typeName = 'Ngày đêm';

        const checkIn = new Date(item.check_in_time).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
        const checkOut = new Date(item.check_out_time).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
        
        const roomObj = roomsData.find(r => r.name === roomName) || { name: roomName, floor: 'Tầng 1' };
        let pricing = calculateRoomPricing(roomObj, item.check_in_time, item.price_type, new Date(item.check_out_time));
        const roomCost = pricing.roomPrice;

        let drinks = item.items || {};
        let totalDrinkCost = 0;
        for (let key in drinks) {
            let qty = drinks[key];
            if (qty > 0) totalDrinkCost += (qty * DRINK_PRICES[key]);
        }

        const discount = Number(item.discount) || 0;
        const surcharge = Number(item.surcharge) || 0;
        const totalPaid = Number(item.total_paid) || 0;
        
        const totalCash = Number(item.prepaid_cash) || 0;
        const totalTransfer = Number(item.prepaid_transfer) || 0;

        html += `
            <tr>
                <td style="text-align: center;"><input type="checkbox" class="history-row-checkbox" value="${item.id}"></td>
                <td><b>${roomName}</b></td>
                <td>${guestName}</td>
                <td>${typeName}</td>
                <td>${checkIn}</td>
                <td>${checkOut}</td>
                <td style="color: #ffc107; font-weight: bold;">${roomCost.toLocaleString()}đ</td>
                <td style="color: #17a2b8; font-weight: bold;">${totalDrinkCost.toLocaleString()}đ</td>
                <td style="color: #ff5722;">+${surcharge.toLocaleString()}đ</td>
                <td style="color: #e91e63;">-${discount.toLocaleString()}đ</td>
                <td style="color: #00ff99; font-weight: bold;">
                    ${totalPaid.toLocaleString()}đ
                    <div style="font-size: 11px; color: #aaa; font-weight: normal;">(TM: ${totalCash.toLocaleString()} | CK: ${totalTransfer.toLocaleString()})</div>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

function filterHistory() {
    const searchVal = document.getElementById('historySearch').value.toLowerCase();
    const priceVal = document.getElementById('historyPriceFilter').value;
    const dateVal = document.getElementById('historyDateFilter').value;

    const filtered = historyData.filter(item => {
        const roomName = item.rooms ? item.rooms.room_name.toLowerCase() : '';
        const guestName = item.customers ? item.customers.guest_name.toLowerCase() : '';
        const checkOutDateStr = item.check_out_time ? item.check_out_time.substring(0, 10) : '';

        const matchText = roomName.includes(searchVal) || guestName.includes(searchVal);
        const matchPrice = priceVal === '' || item.price_type === priceVal;
        const matchDate = dateVal === '' || checkOutDateStr === dateVal;

        return matchText && matchPrice && matchDate;
    });

    renderHistoryTable(filtered);
}

// ---------------- KHÁCH HÀNG ----------------
async function searchCustomer(keyword) {
    const box = document.getElementById('customerSuggestions');
    if (!keyword || keyword.trim().length < 2) { box.style.display = 'none'; return; }
    const { data, error } = await supabaseClient.from('customers').select('*').or(`guest_name.ilike.%${keyword}%,guest_cccd.ilike.%${keyword}%`).limit(5);
    if (error || !data || data.length === 0) { box.style.display = 'none'; return; }
    let html = '';
    data.forEach(c => { html += `<div class="suggestion-item" onclick='selectCustomer(${JSON.stringify(c)})'><b>${c.guest_name}</b> - CCCD: ${c.guest_cccd || 'Không có'} (Đã ở: ${c.stay_count} lần)</div>`; });
    box.innerHTML = html; box.style.display = 'block';
}

function selectCustomer(c) {
    selectedCustomerId = c.id;
    document.getElementById('guestName').value = c.guest_name || '';
    document.getElementById('guestCCCD').value = c.guest_cccd || '';
    document.getElementById('guestDob').value = c.guest_dob || '';
    document.getElementById('addressDetail').value = c.address_detail || '';
    document.getElementById('ward').value = c.ward || '';
    document.getElementById('district').value = c.district || '';
    document.getElementById('province').value = c.province || '';
    document.getElementById('customerSuggestions').style.display = 'none';
    document.getElementById('searchCustomerInput').value = '';
}

async function searchCustomerUpdate(keyword) {
    const box = document.getElementById('updateCustomerSuggestions');
    if (!keyword || keyword.trim().length < 2) { box.style.display = 'none'; return; }
    const { data, error } = await supabaseClient.from('customers').select('*').or(`guest_name.ilike.%${keyword}%,guest_cccd.ilike.%${keyword}%`).limit(5);
    if (error || !data || data.length === 0) { box.style.display = 'none'; return; }
    let html = '';
    data.forEach(c => { html += `<div class="suggestion-item" onclick='selectCustomerUpdate(${JSON.stringify(c)})'><b>${c.guest_name}</b> - CCCD: ${c.guest_cccd || 'Không có'} (Đã ở: ${c.stay_count} lần)</div>`; });
    box.innerHTML = html; box.style.display = 'block';
}

function selectCustomerUpdate(c) {
    selectedUpdateCustomerId = c.id;
    document.getElementById('updateGuestName').value = c.guest_name || '';
    document.getElementById('updateGuestCCCD').value = c.guest_cccd || '';
    document.getElementById('updateGuestDob').value = c.guest_dob || '';
    document.getElementById('updateAddressDetail').value = c.address_detail || '';
    document.getElementById('updateWard').value = c.ward || '';
    document.getElementById('updateDistrict').value = c.district || '';
    document.getElementById('updateProvince').value = c.province || '';
    document.getElementById('updateCustomerSuggestions').style.display = 'none';
    document.getElementById('updateSearchCustomerInput').value = '';
}

// ---------------- NHẬN PHÒNG ----------------
function closeModal() { document.getElementById('checkinModal').style.display = 'none'; }
function resetModalForm() {
    document.getElementById('priceType').value = 'hourly';
    currentDrinks = { nuoc_suoi: 0, nuoc_ngot: 0, bia: 0, mi_tom: 0 };
    updateDrinksUI();
    document.getElementById('prepaidAmount').value = 0;
    document.querySelector('input[name="prepaidMethod"][value="cash"]').checked = true;
    document.getElementById('roomNotes').value = '';
    
    document.getElementById('searchCustomerInput').value = '';
    document.getElementById('guestName').value = '';
    document.getElementById('guestCCCD').value = '';
    document.getElementById('guestDob').value = '';
    document.getElementById('addressDetail').value = '';
    document.getElementById('ward').value = '';
    document.getElementById('district').value = '';
    document.getElementById('province').value = '';
    selectedCustomerId = null;
    handlePriceTypeChange();
}

function handlePriceTypeChange() {
    const pType = document.getElementById('priceType').value;
    document.getElementById('guestInfoSection').style.display = (pType === 'overnight' || pType === 'daily') ? 'block' : 'none';
}

function adjustDrink(key, delta) { currentDrinks[key] = Math.max(0, currentDrinks[key] + delta); updateDrinksUI(); }
function updateDrinksUI() {
    document.getElementById('count_nuoc_suoi').innerText = currentDrinks.nuoc_suoi;
    document.getElementById('count_nuoc_ngot').innerText = currentDrinks.nuoc_ngot;
    document.getElementById('count_bia').innerText = currentDrinks.bia;
    document.getElementById('count_mi_tom').innerText = currentDrinks.mi_tom;
}

async function submitCheckIn() {
    const priceType = document.getElementById('priceType').value;
    const amount = parseFloat(document.getElementById('prepaidAmount').value) || 0;
    const method = document.querySelector('input[name="prepaidMethod"]:checked').value;
    const cash = method === 'cash' ? amount : 0;
    const transfer = method === 'transfer' ? amount : 0;
    
    let custId = selectedCustomerId;

    if (priceType !== 'hourly') {
        const name = document.getElementById('guestName').value;
        const cccd = document.getElementById('guestCCCD').value;
        if (!name) { alert('Vui lòng nhập tên khách hàng!'); return; }

        const customerPayload = {
            guest_name: name, guest_cccd: cccd, guest_dob: document.getElementById('guestDob').value || null,
            address_detail: document.getElementById('addressDetail').value, ward: document.getElementById('ward').value,
            district: document.getElementById('district').value, province: document.getElementById('province').value
        };

        if (custId) {
            await supabaseClient.from('customers').update(customerPayload).eq('id', custId);
        } else {
            const { data: newCust, error: custErr } = await supabaseClient.from('customers').insert([customerPayload]).select().single();
            if (custErr) { alert('Lỗi lưu khách: ' + custErr.message); return; }
            custId = newCust.id;
        }
    }

    try {
        await supabaseClient.from('bookings').insert([{ 
            room_id: selectedRoomId, status: 'active', price_type: priceType, items: currentDrinks, 
            prepaid_cash: cash, prepaid_transfer: transfer,
            payment_method: method, notes: document.getElementById('roomNotes').value, customer_id: custId
        }]);
        await supabaseClient.from('rooms').update({ status: 'co_khach' }).eq('id', selectedRoomId);
        closeModal(); fetchRoomsFromSupabase();
    } catch (err) { alert('Lỗi: ' + err.message); }
}

async function updateRoomStatusInSupabase(roomId, status) {
    await supabaseClient.from('rooms').update({ status: status }).eq('id', roomId);
    fetchRoomsFromSupabase();
}

// ---------------- CẬP NHẬT PHÒNG ----------------
function openUpdateModal(roomName) {
    // Tính toán tiền tạm tính y hệt ngoài dashboard
    const room = roomsData.find(r => r.id === selectedRoomId);
    let pricing = calculateRoomPricing(room, currentActiveBooking.check_in_time, currentActiveBooking.price_type, new Date());
    
    let totalDrinkPrice = 0;
    if (currentActiveBooking.items) {
        for (let key in currentActiveBooking.items) {
            let qty = currentActiveBooking.items[key];
            if (qty > 0) totalDrinkPrice += (qty * DRINK_PRICES[key]);
        }
    }
    let tempTotal = pricing.roomPrice + totalDrinkPrice;

    // Đẩy thông tin lên tiêu đề Modal
    document.getElementById('updateModalTitle').innerHTML = `Phòng ${roomName} - Tạm tính: <span style="color: #ffc107;">${tempTotal.toLocaleString()}đ</span>`;
    
    document.getElementById('updatePriceType').value = currentActiveBooking.price_type;
    
    let d = new Date(currentActiveBooking.check_in_time);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    document.getElementById('updateCheckInTime').value = d.toISOString().slice(0,16);
    
    updateDrinks = { ...currentActiveBooking.items };
    document.getElementById('update_count_nuoc_suoi').innerText = updateDrinks.nuoc_suoi;
    document.getElementById('update_count_nuoc_ngot').innerText = updateDrinks.nuoc_ngot;
    document.getElementById('update_count_bia').innerText = updateDrinks.bia;
    document.getElementById('update_count_mi_tom').innerText = updateDrinks.mi_tom;
    
    let totalPrepaid = (Number(currentActiveBooking.prepaid_cash) || 0) + (Number(currentActiveBooking.prepaid_transfer) || 0);
    document.getElementById('currentPrepaidDisplay').innerText = totalPrepaid.toLocaleString() + 'đ (TM: ' + (currentActiveBooking.prepaid_cash||0) + ' | CK: ' + (currentActiveBooking.prepaid_transfer||0) + ')';
    
    document.getElementById('updatePrepaidAmount').value = 0;
    document.querySelector('input[name="updatePrepaidMethod"][value="cash"]').checked = true;
    document.getElementById('updateRoomNotes').value = currentActiveBooking.notes || '';
    
    selectedUpdateCustomerId = currentActiveBooking.customer_id;
    if(currentActiveBooking.customers) {
        let c = currentActiveBooking.customers;
        document.getElementById('updateGuestName').value = c.guest_name || '';
        document.getElementById('updateGuestCCCD').value = c.guest_cccd || '';
        document.getElementById('updateGuestDob').value = c.guest_dob || '';
        document.getElementById('updateAddressDetail').value = c.address_detail || '';
        document.getElementById('updateWard').value = c.ward || '';
        document.getElementById('updateDistrict').value = c.district || '';
        document.getElementById('updateProvince').value = c.province || '';
    } else {
        document.getElementById('updateGuestName').value = '';
        document.getElementById('updateGuestCCCD').value = '';
        document.getElementById('updateGuestDob').value = '';
        document.getElementById('updateAddressDetail').value = '';
        document.getElementById('updateWard').value = '';
        document.getElementById('updateDistrict').value = '';
        document.getElementById('updateProvince').value = '';
    }
    
    lockGuestInfoFields(true);
    
    handleUpdatePriceTypeChange();
    document.getElementById('updateModal').style.display = 'flex';
}

function handleUpdatePriceTypeChange() {
    const pType = document.getElementById('updatePriceType').value;
    document.getElementById('updateGuestInfoSection').style.display = (pType === 'overnight' || pType === 'daily') ? 'block' : 'none';
}

function closeUpdateModal() { document.getElementById('updateModal').style.display = 'none'; }
function adjustUpdateDrink(key, delta) {
    updateDrinks[key] = Math.max(0, updateDrinks[key] + delta);
    document.getElementById('update_count_' + key).innerText = updateDrinks[key];
}

async function submitUpdateRoom() {
    const priceType = document.getElementById('updatePriceType').value;
    const amount = parseFloat(document.getElementById('updatePrepaidAmount').value) || 0;
    const method = document.querySelector('input[name="updatePrepaidMethod"]:checked').value;
    
    const newCash = (parseFloat(currentActiveBooking.prepaid_cash) || 0) + (method === 'cash' ? amount : 0);
    const newTransfer = (parseFloat(currentActiveBooking.prepaid_transfer) || 0) + (method === 'transfer' ? amount : 0);
    const newCheckIn = new Date(document.getElementById('updateCheckInTime').value).toISOString();

    let custId = selectedUpdateCustomerId;

    if (priceType !== 'hourly') {
        const name = document.getElementById('updateGuestName').value;
        const cccd = document.getElementById('updateGuestCCCD').value;
        if (!name) { alert('Vui lòng nhập tên khách hàng bổ sung!'); return; }

        const customerPayload = {
            guest_name: name, guest_cccd: cccd, guest_dob: document.getElementById('updateGuestDob').value || null,
            address_detail: document.getElementById('updateAddressDetail').value, ward: document.getElementById('updateWard').value,
            district: document.getElementById('updateDistrict').value, province: document.getElementById('updateProvince').value
        };

        if (custId) {
            await supabaseClient.from('customers').update(customerPayload).eq('id', custId);
        } else {
            const { data: newCust, error: custErr } = await supabaseClient.from('customers').insert([customerPayload]).select().single();
            if (custErr) { alert('Lỗi lưu khách: ' + custErr.message); return; }
            custId = newCust.id;
        }
    }

    try {
        await supabaseClient.from('bookings').update({
            price_type: priceType,
            check_in_time: newCheckIn, items: updateDrinks,
            prepaid_cash: newCash, prepaid_transfer: newTransfer,
            notes: document.getElementById('updateRoomNotes').value,
            customer_id: custId
        }).eq('id', currentActiveBooking.id);
        
        closeUpdateModal(); alert('Cập nhật thành công!'); fetchRoomsFromSupabase();
    } catch (err) { alert('Lỗi: ' + err.message); }
}

// ---------------- THANH TOÁN & LƯU DB CHUẨN XÁC ----------------
function openCheckoutModal() {
    closeUpdateModal();
    document.getElementById('checkoutModalTitle').innerText = `Thanh toán phòng`;

    const room = roomsData.find(r => r.id === selectedRoomId);
    let pricing = calculateRoomPricing(room, currentActiveBooking.check_in_time, currentActiveBooking.price_type, new Date());

    let totalDrinkPrice = 0;
    let drinkDetailHTML = '';
    for (let key in updateDrinks) {
        let qty = updateDrinks[key];
        if (qty > 0) {
            let cost = qty * DRINK_PRICES[key];
            totalDrinkPrice += cost;
            drinkDetailHTML += `<div class="checkout-row"><span>Đồ uống - ${key} (${qty}):</span> <b>${cost.toLocaleString()}đ</b></div>`;
        }
    }

    let finalBreakdownHTML = pricing.breakdownHTML + drinkDetailHTML;
    let totalPrepaid = (Number(currentActiveBooking.prepaid_cash) || 0) + (Number(currentActiveBooking.prepaid_transfer) || 0);
    finalBreakdownHTML += `<div class="checkout-row" style="color: #28a745;"><span>Đã thanh toán trước:</span> <b>- ${totalPrepaid.toLocaleString()}đ (TM: ${currentActiveBooking.prepaid_cash||0} | CK: ${currentActiveBooking.prepaid_transfer||0})</b></div>`;

    document.getElementById('checkoutBreakdown').innerHTML = finalBreakdownHTML;
    document.getElementById('checkoutDiscount').value = 0;
    document.getElementById('checkoutSurcharge').value = 0;
    
    window.calculatedRoomPrice = pricing.roomPrice;
    window.calculatedDrinkPrice = totalDrinkPrice;
    window.calculatedPrepaid = totalPrepaid;

    calculateFinalTotal();
    document.getElementById('checkoutModal').style.display = 'flex';
}

function calculateFinalTotal() {
    let discount = parseFloat(document.getElementById('checkoutDiscount').value) || 0;
    let surcharge = parseFloat(document.getElementById('checkoutSurcharge').value) || 0;

    // Công thức tính số tiền CÒN LẠI cần thu lúc ra về
    let finalTotal = window.calculatedRoomPrice + window.calculatedDrinkPrice + surcharge - discount - window.calculatedPrepaid;
    if (finalTotal < 0) finalTotal = 0;

    document.getElementById('finalTotalAmount').innerText = finalTotal.toLocaleString() + 'đ';
}

function closeCheckoutModal() { document.getElementById('checkoutModal').style.display = 'none'; }

async function submitCheckout() {
    try {
        const discountVal = parseFloat(document.getElementById('checkoutDiscount').value) || 0;
        const surchargeVal = parseFloat(document.getElementById('checkoutSurcharge').value) || 0;
        
        // Bốc số tiền khách cần trả CÒN LẠI lúc checkout
        let finalTotalText = document.getElementById('finalTotalAmount').innerText;
        let remainingToPay = parseFloat(finalTotalText.replace(/[^0-9]/g, '')) || 0;

        const method = document.getElementById('checkoutPaymentMethod').value;
        
        // Ép dồn tiền thanh toán còn lại vào thẳng số tiền đã cọc ban đầu theo đúng hình thức (TM/CK)
        let finalCash = (parseFloat(currentActiveBooking.prepaid_cash) || 0) + (method === 'cash' ? remainingToPay : 0);
        let finalTransfer = (parseFloat(currentActiveBooking.prepaid_transfer) || 0) + (method === 'transfer' ? remainingToPay : 0);
        
        // Tổng thu thực tế toàn bộ cuốc khách
        let finalTotalPaid = finalCash + finalTransfer;

        await supabaseClient.from('bookings').update({ 
            status: 'completed', 
            check_out_time: new Date().toISOString(),
            discount: discountVal,
            surcharge: surchargeVal,
            prepaid_cash: finalCash,         // Lúc này biến thành TỔNG TIỀN MẶT ĐÃ THU
            prepaid_transfer: finalTransfer, // Lúc này biến thành TỔNG CHUYỂN KHOẢN ĐÃ THU
            total_paid: finalTotalPaid       // Ghi nhận tổng thu thực tế
        }).eq('id', currentActiveBooking.id);

        await supabaseClient.from('rooms').update({ status: 'chuadon' }).eq('id', selectedRoomId);
        
        if (currentActiveBooking.customer_id) {
            const { data: custData } = await supabaseClient.from('customers').select('stay_count').eq('id', currentActiveBooking.customer_id).single();
            if (custData) {
                await supabaseClient.from('customers').update({ stay_count: (custData.stay_count || 1) + 1 }).eq('id', currentActiveBooking.customer_id);
            }
        }
        closeCheckoutModal();
        alert('Thanh toán thành công và đã ghi nhận đầy đủ vào lịch sử!');
        fetchRoomsFromSupabase();
        updateRevenueSummary();
    } catch (err) { alert('Lỗi: ' + err.message); }
}

async function initApp() {
    await loadSystemSettings();
    fetchRoomsFromSupabase();
}
initApp();

// =====================================================================
// CHỨC NĂNG CHUYỂN PHÒNG
// =====================================================================
function openMoveRoomModal() {
    closeUpdateModal();
    const container = document.getElementById('availableRoomsList');
    container.innerHTML = '';
    const availableRooms = roomsData.filter(r => r.status === 'trong');

    if (availableRooms.length === 0) {
        container.innerHTML = `<p style="text-align: center; color: #ff5722;">Hiện tại không có phòng trống nào!</p>`;
    } else {
        availableRooms.forEach(room => {
            const btn = document.createElement('button');
            btn.className = 'btn-submit';
            btn.style.backgroundColor = '#28a745';
            btn.style.marginTop = '0';
            btn.innerHTML = `Phòng ${room.name} (${room.floor})`;
            btn.onclick = () => executeMoveRoom(room.id, room.name);
            container.appendChild(btn);
        });
    }
    document.getElementById('moveRoomModal').style.display = 'flex';
}

function closeMoveRoomModal() { document.getElementById('moveRoomModal').style.display = 'none'; }

async function executeMoveRoom(newRoomId, newRoomName) {
    const oldRoomId = selectedRoomId;
    const bookingId = currentActiveBooking.id;
    const oldRoomObj = roomsData.find(r => r.id === oldRoomId);

    if (!confirm(`Bạn có chắc chắn muốn chuyển khách từ phòng ${oldRoomObj.name} sang phòng ${newRoomName}?`)) return;

    try {
        await supabaseClient.from('bookings').update({ room_id: newRoomId }).eq('id', bookingId);
        await supabaseClient.from('rooms').update({ status: 'chuadon' }).eq('id', oldRoomId);
        await supabaseClient.from('rooms').update({ status: 'co_khach' }).eq('id', newRoomId);

        closeMoveRoomModal();
        alert(`Đã chuyển sang phòng ${newRoomName} thành công!`);
        fetchRoomsFromSupabase();
    } catch (err) { alert('Lỗi chuyển phòng: ' + err.message); }
}

// =====================================================================
// XÓA BẢN GHI BẢO MẬT ADMIN
// =====================================================================
function toggleSelectAll(master) {
    const checkboxes = document.querySelectorAll('.history-row-checkbox');
    checkboxes.forEach(cb => cb.checked = master.checked);
}

function openDeleteAdminModal() {
    const checkedBoxes = document.querySelectorAll('.history-row-checkbox:checked');
    if (checkedBoxes.length === 0) { alert('Vui lòng tích chọn ít nhất một bản ghi cần xóa!'); return; }
    document.getElementById('adminPasswordInput').value = '';
    document.getElementById('adminStepPassword').style.display = 'block';
    document.getElementById('adminStepConfirm').style.display = 'none';
    document.getElementById('adminDeleteModal').style.display = 'flex';
}

function closeAdminDeleteModal() { document.getElementById('adminDeleteModal').style.display = 'none'; }

function verifyAdminPassword() {
    const pass = document.getElementById('adminPasswordInput').value;
    if (pass === 'phong2000') {
        const count = document.querySelectorAll('.history-row-checkbox:checked').length;
        document.getElementById('deleteConfirmText').innerText = `Bạn có thực sự muốn xóa ${count} bản ghi đã chọn không?`;
        document.getElementById('adminStepPassword').style.display = 'none';
        document.getElementById('adminStepConfirm').style.display = 'block';
    } else { alert('Mật khẩu Admin không chính xác!'); }
}

async function executeDeleteBookings() {
    const checkedBoxes = document.querySelectorAll('.history-row-checkbox:checked');
    const idsToDelete = Array.from(checkedBoxes).map(cb => cb.value);
    try {
        const { error } = await supabaseClient.from('bookings').delete().in('id', idsToDelete);
        if (error) throw error;
        closeAdminDeleteModal();
        alert('Xóa các bản ghi thành công!');
        fetchHistoryFromSupabase();
        updateRevenueSummary();
    } catch (err) { alert('Lỗi khi xóa: ' + err.message); }
}

// =====================================================================
// KHÓA / MỞ KHÓA THÔNG TIN KHÁCH HÀNG (MODAL CẬP NHẬT)
// =====================================================================
function lockGuestInfoFields(isLocked) {
    const fields = [
        'updateSearchCustomerInput', 'updateGuestName', 'updateGuestCCCD', 
        'updateGuestDob', 'updateAddressDetail', 'updateWard', 
        'updateDistrict', 'updateProvince'
    ];
    
    fields.forEach(id => {
        document.getElementById(id).disabled = isLocked;
    });

    const btn = document.getElementById('btnEditGuest');
    if (btn) {
        if (isLocked) {
            btn.innerText = "Sửa";
            btn.style.backgroundColor = "#2a2a2a";
            btn.style.borderColor = "#444";
        } else {
            btn.innerText = "Khóa";
            btn.style.backgroundColor = "#dc3545"; // Màu đỏ để cảnh báo đang chỉnh sửa
            btn.style.borderColor = "#dc3545";
        }
    }
}

function toggleEditGuestInfo() {
    const nameInput = document.getElementById('updateGuestName');
    const isCurrentlyLocked = nameInput.disabled;
    
    lockGuestInfoFields(!isCurrentlyLocked); // Đảo trạng thái
    
    if (isCurrentlyLocked) {
        document.getElementById('updateSearchCustomerInput').focus(); // Tự động focus vào ô tìm kiếm khi mở khóa
    }
}

// =====================================================================
// TÍNH TOÁN VÀ HIỂN THỊ DOANH THU TRÊN HEADER
// =====================================================================
async function updateRevenueSummary() {
    try {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        const startOfYesterday = new Date(startOfToday);
        startOfYesterday.setDate(startOfYesterday.getDate() - 1);
        
        // Lấy tất cả cuốc khách đã hoàn thành từ hôm qua đến giờ
        const { data, error } = await supabaseClient
            .from('bookings')
            .select('check_out_time, total_paid')
            .eq('status', 'completed')
            .gte('check_out_time', startOfYesterday.toISOString());

        if (error) throw error;

        let revToday = 0;
        let revYesterday = 0;

        data.forEach(booking => {
            const checkoutTime = new Date(booking.check_out_time);
            const paid = Number(booking.total_paid) || 0;
            
            if (checkoutTime >= startOfToday) {
                revToday += paid; // Cuốc trả phòng hôm nay
            } else if (checkoutTime >= startOfYesterday && checkoutTime < startOfToday) {
                revYesterday += paid; // Cuốc trả phòng hôm qua
            }
        });

        document.getElementById('revToday').innerText = revToday.toLocaleString() + 'đ';
        document.getElementById('revYesterday').innerText = revYesterday.toLocaleString() + 'đ';
    } catch (err) {
        console.error('Lỗi tính doanh thu:', err.message);
    }
}

// Gọi hàm này ngay khi tải trang để hiển thị luôn
updateRevenueSummary();

// =====================================================================
// TÍNH NĂNG XUẤT HÓA ĐƠN EXCEL & LƯU DATABASE (CÓ ĐA NGÔN NGỮ & STYLE)
// =====================================================================
let invoiceBookingId = null;

function openInvoiceModal() {
    const checkedBoxes = document.querySelectorAll('.history-row-checkbox:checked');
    if (checkedBoxes.length !== 1) {
        alert('Vui lòng tích chọn CHÍNH XÁC 1 bản ghi để xuất hóa đơn!');
        return;
    }
    
    invoiceBookingId = checkedBoxes[0].value;
    const booking = historyData.find(b => b.id === invoiceBookingId);

    document.getElementById('invoiceGuestName').value = booking.customers ? booking.customers.guest_name : 'Khách lẻ';
    document.getElementById('invoiceAddress').value = booking.customers ? booking.customers.address_detail : '';
    document.getElementById('invoiceMST').value = '';
    document.getElementById('invoiceVAT').value = '0';
    document.getElementById('invoiceLang').value = 'vi';

    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(now - tzOffset)).toISOString().slice(0, 16);
    document.getElementById('invoiceDate').value = localISOTime;

    document.getElementById('invoiceSettingsModal').style.display = 'flex';
}

function closeInvoiceModal() { document.getElementById('invoiceSettingsModal').style.display = 'none'; }

async function generateInvoiceNumber(dateObj) {
    const yy = dateObj.getFullYear().toString().slice(-2);
    const mm = (dateObj.getMonth() + 1).toString().padStart(2, '0');
    const prefix = `INV${yy}${mm}`;

    const { data, error } = await supabaseClient
        .from('invoices')
        .select('invoice_no')
        .ilike('invoice_no', `${prefix}%`)
        .order('invoice_no', { ascending: false })
        .limit(1);

    if (error) { console.error('Lỗi tạo số HĐ:', error); return `${prefix}001`; }
    if (data && data.length > 0) {
        const lastNum = parseInt(data[0].invoice_no.slice(-3));
        return `${prefix}${(lastNum + 1).toString().padStart(3, '0')}`;
    }
    return `${prefix}001`;
}

async function exportExcelInvoice() {
    const booking = historyData.find(b => b.id === invoiceBookingId);
    if (!booking) return;

    // --- LẤY THÔNG TIN TỪ MODAL & DB ---
    const lang = document.getElementById('invoiceLang').value;
    const guestName = document.getElementById('invoiceGuestName').value || (lang === 'vi' ? 'Khách lẻ' : 'Walk-in Guest');
    const mst = document.getElementById('invoiceMST').value || '';
    const address = document.getElementById('invoiceAddress').value || '';
    const vatRate = parseFloat(document.getElementById('invoiceVAT').value) || 0;
    
    const exportDateObj = new Date(document.getElementById('invoiceDate').value);
    const exportDateStr = exportDateObj.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-GB');

    const invoiceNo = await generateInvoiceNumber(exportDateObj);
    const roomName = booking.rooms ? booking.rooms.room_name : 'N/A';
    const isDoubleRoom = (roomName === '401' || roomName === '501');
    const checkIn = new Date(booking.check_in_time).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-GB');
    const checkOut = new Date(booking.check_out_time).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-GB');

    const roomObj = roomsData.find(r => r.name === roomName) || { name: roomName, floor: 'Tầng 1' };
    let pricing = calculateRoomPricing(roomObj, booking.check_in_time, booking.price_type, new Date(booking.check_out_time));

    // --- TỪ ĐIỂN DỊCH NGÔN NGỮ ---
    const t = {
        hotelName: "HOTEL VẠN HẢI",
        hotelAddr: lang === 'vi' ? "Địa chỉ: 56/4 Lê Quang Hoà, P. Thới An, TP. Hồ Chí Minh" : "Address: 56/4 Le Quang Hoa, Thoi An Ward, HCMC",
        hotelPhone: lang === 'vi' ? "SĐT: 0858 718 588" : "Phone: +84 858 718 588",
        title: lang === 'vi' ? "HÓA ĐƠN THANH TOÁN DỊCH VỤ" : "SERVICE INVOICE",
        invNo: lang === 'vi' ? "Số hóa đơn:" : "Invoice No:",
        date: lang === 'vi' ? "Ngày xuất:" : "Date:",
        guest: lang === 'vi' ? "Khách hàng:" : "Guest Name:",
        room: lang === 'vi' ? "Số phòng:" : "Room No:",
        tax: lang === 'vi' ? "Mã số thuế:" : "Tax Code:",
        in: lang === 'vi' ? "Giờ vào:" : "Check-in:",
        addr: lang === 'vi' ? "Địa chỉ:" : "Address:",
        out: lang === 'vi' ? "Giờ ra:" : "Check-out:",
        thSTT: "STT",
        thDesc: lang === 'vi' ? "Nội dung dịch vụ" : "Description",
        thQty: lang === 'vi' ? "Số lượng" : "Qty",
        thPrice: lang === 'vi' ? "Đơn giá" : "Unit Price",
        thAmt: lang === 'vi' ? "Thành tiền" : "Amount",
        roomType: isDoubleRoom ? (lang === 'vi' ? "Tiền phòng đôi" : "Double Room Charge") : (lang === 'vi' ? "Tiền phòng đơn" : "Single Room Charge"),
        water: lang === 'vi' ? "Nước suối" : "Mineral Water",
        coke: lang === 'vi' ? "Nước ngọt" : "Soft Drink",
        beer: "Bia / Beer",
        noodle: lang === 'vi' ? "Mì tôm" : "Instant Noodles",
        surcharge: lang === 'vi' ? "Phụ thu" : "Surcharge",
        discount: lang === 'vi' ? "Giảm giá" : "Discount",
        subtotal: lang === 'vi' ? "Cộng tiền hàng (Trước thuế):" : "Subtotal (Before Tax):",
        vat: lang === 'vi' ? `Thuế GTGT (${vatRate}%):` : `VAT (${vatRate}%):`,
        total: lang === 'vi' ? "Tổng cộng thanh toán:" : "Total Amount:",
        signGuest: lang === 'vi' ? "Khách hàng" : "Guest",
        signStaff: lang === 'vi' ? "Lễ tân" : "Receptionist"
    };

    // --- TÍNH TOÁN TIỀN NÔNG ---
    let totalDrinkCost = 0;
    let drinks = booking.items || {};
    for (let k in drinks) { if (drinks[k] > 0) totalDrinkCost += drinks[k] * DRINK_PRICES[k]; }

    const surcharge = Number(booking.surcharge) || 0;
    const discount = Number(booking.discount) || 0;
    
    // Yêu cầu: Giảm giá trừ thẳng vào tiền trước thuế
    const subtotal = pricing.roomPrice + totalDrinkCost + surcharge - discount;
    const vatAmount = subtotal * (vatRate / 100);
    const finalTotal = subtotal + vatAmount;

    // --- LƯU VÀO DATABASE `invoices` ---
    try {
        await supabaseClient.from('invoices').insert([{
            invoice_no: invoiceNo, export_date: exportDateObj.toISOString(), guest_name: guestName, tax_code: mst,
            address: address, room_name: roomName, check_in_time: booking.check_in_time, check_out_time: booking.check_out_time,
            room_cost: pricing.roomPrice, drink_cost: totalDrinkCost, surcharge: surcharge, discount: discount,
            subtotal: subtotal, vat_rate: vatRate, vat_amount: vatAmount, final_total: finalTotal
        }]);
    } catch (err) { console.error('Lỗi lưu DB hóa đơn:', err); }

    // --- DÀN TRANG EXCEL ---
    let excelRows = [
        [t.hotelName],
        [t.hotelAddr],
        [t.hotelPhone],
        [],
        [t.title, '', '', '', ''],
        [],
        [t.invNo, invoiceNo, '', t.date, exportDateStr],
        [t.guest, guestName, '', t.room, roomName],
        [t.tax, mst, '', t.in, checkIn],
        [t.addr, address, '', t.out, checkOut],
        [],
        [t.thSTT, t.thDesc, t.thQty, t.thPrice, t.thAmt]
    ];

    let rIdx = 1;
    // Dòng tiền phòng
    excelRows.push([rIdx++, `${t.roomType} (${booking.price_type})`, 1, pricing.roomPrice, pricing.roomPrice]);
    
    // Dòng đồ uống
    for (let key in drinks) {
        if (drinks[key] > 0) {
            let name = key === 'nuoc_suoi' ? t.water : (key === 'nuoc_ngot' ? t.coke : (key === 'bia' ? t.beer : t.noodle));
            excelRows.push([rIdx++, name, drinks[key], DRINK_PRICES[key], drinks[key] * DRINK_PRICES[key]]);
        }
    }
    
    // Dòng phụ thu & giảm giá
    if (surcharge > 0) excelRows.push([rIdx++, t.surcharge, 1, surcharge, surcharge]);
    if (discount > 0) excelRows.push([rIdx++, t.discount, 1, -discount, -discount]);

    // Trống 1 dòng trước khi chốt
    excelRows.push(['', '', '', '', '']);
    excelRows.push(['', '', '', t.subtotal, subtotal]);
    excelRows.push(['', '', '', t.vat, vatAmount]);
    excelRows.push(['', '', '', t.total, finalTotal]);
    excelRows.push([]);
    excelRows.push(['', t.signGuest, '', '', t.signStaff]);

    // --- APPLY STYLE & XUẤT FILE ---
    const ws = XLSX.utils.aoa_to_sheet(excelRows);

    // Kéo giãn cột cho đẹp
    ws['!cols'] = [{ wch: 15 }, { wch: 40 }, { wch: 10 }, { wch: 25 }, { wch: 25 }];

    // Gộp ô tiêu đề hóa đơn từ cột A đến E (hàng số 5, index r: 4)
    ws['!merges'] = [
        { s: { r: 4, c: 0 }, e: { r: 4, c: 4 } }
    ];

    // Format từng ô (Cell styling)
    for (let R = 0; R < excelRows.length; ++R) {
        for (let C = 0; C < excelRows[R].length; ++C) {
            const cellRef = XLSX.utils.encode_cell({r: R, c: C});
            if (!ws[cellRef]) continue;

            let s = { font: { name: "Arial", sz: 11 }, alignment: { vertical: "center" } };

            // In đậm thông tin KS
            if (R === 0 && C === 0) { s.font.bold = true; s.font.sz = 14; }
            if (R === 1 || R === 2) { s.font.italic = true; }
            
            // Tiêu đề HÓA ĐƠN
            if (R === 4 && C === 0) { s.font.bold = true; s.font.sz = 16; s.alignment.horizontal = "center"; }

            // In đậm tiêu đề bảng (dòng 11 index = 11)
            if (R === 11) {
                s.font.bold = true;
                s.fill = { fgColor: { rgb: "EFEFEF" } };
                s.border = { top: {style:'thin'}, bottom: {style:'thin'}, left: {style:'thin'}, right: {style:'thin'} };
                s.alignment.horizontal = "center";
            }

            // Đóng viền cho các dòng dữ liệu trong bảng
            if (R > 11 && R < excelRows.length - 6 && excelRows[R][0] !== '') {
                s.border = { top: {style:'thin'}, bottom: {style:'thin'}, left: {style:'thin'}, right: {style:'thin'} };
                if (C === 3 || C === 4) s.numFmt = '#,##0'; // Format số tiền
            }

            // In đậm phần tổng kết
            if (R >= excelRows.length - 5 && R <= excelRows.length - 3) {
                if (C === 3 || C === 4) { s.font.bold = true; s.numFmt = '#,##0'; }
            }

            // Chữ ký
            if (R === excelRows.length - 1) { s.font.bold = true; s.alignment.horizontal = "center"; }

            ws[cellRef].s = s;
        }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "HoaDon");
    XLSX.writeFile(wb, `${invoiceNo}_${guestName.replace(/\s+/g, '_')}.xlsx`);
    
    closeInvoiceModal();
}

// =====================================================================
// ĐỒNG HỒ THỜI GIAN THỰC (HEADER LỄ TÂN)
// =====================================================================
function startRealtimeClock() {
    const timeEl = document.getElementById('clockTime');
    const dateEl = document.getElementById('clockDate');
    if (!timeEl || !dateEl) return;

    const days = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
    
    setInterval(() => {
        const now = new Date();
        
        // Cập nhật giờ:phút:giây
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        timeEl.innerText = `${h}:${m}:${s}`;

        // Cập nhật Thứ, ngày/tháng/năm
        const dayName = days[now.getDay()];
        const d = String(now.getDate()).padStart(2, '0');
        const mo = String(now.getMonth() + 1).padStart(2, '0');
        const y = now.getFullYear();
        dateEl.innerText = `${dayName}, ${d}/${mo}/${y}`;
    }, 1000); // Nhảy số mỗi 1 giây
}

// Chạy đồng hồ ngay lập tức
startRealtimeClock();