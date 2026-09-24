const SUPABASE_URL = 'https://wohnxhepcaqxyzrgjbrj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndvaG54aGVwY2FxeHl6cmdqYnJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwNzE4MjgsImV4cCI6MjEwNTY0NzgyOH0.KvQXewy2kBRwGJB8treP2QFu6Cj6maVGxSRYlhoGTAw'; // DÁN LẠI KEY CỦA MÀY

let supabaseClient = null;
if (window.supabase) supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let selectedRoomId = null;
let dirtyRooms = [];

// Hàm tính toán thời gian trôi qua
function timeAgo(dateString) {
    if (!dateString) return "Không rõ";
    const now = new Date();
    const past = new Date(dateString);
    const diffMs = now - past;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 60) return `${diffMins} phút trước`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} giờ ${diffMins % 60} phút trước`;
    return `${Math.floor(diffHours / 24)} ngày trước`;
}

// Lấy danh sách phòng chưa dọn
async function fetchDirtyRooms() {
    const listContainer = document.getElementById('dirtyRoomsList');
    
    try {
        // Lấy các phòng có trạng thái 'chuadon'
        const { data: rooms, error } = await supabaseClient
            .from('rooms')
            .select('id, room_name')
            .eq('status', 'chuadon')
            .order('room_name', { ascending: true });

        if (error) throw error;

        if (rooms.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state">
                    <h3 style="color: #28a745; font-size: 20px; margin-bottom: 10px;">Tuyệt vời!</h3>
                    <p>Tất cả các phòng đều đã được dọn sạch sẽ.</p>
                </div>`;
            return;
        }

        // Với mỗi phòng, query bảng bookings để tìm giờ checkout gần nhất
        let roomsWithTime = [];
        for (let room of rooms) {
            const { data: bookingData } = await supabaseClient
                .from('bookings')
                .select('check_out_time')
                .eq('room_id', room.id)
                .eq('status', 'completed')
                .order('check_out_time', { ascending: false })
                .limit(1);

            let lastCheckout = bookingData && bookingData.length > 0 ? bookingData[0].check_out_time : null;
            roomsWithTime.push({ ...room, lastCheckout });
        }

        renderDirtyRooms(roomsWithTime);

    } catch (err) {
        console.error('Lỗi lấy danh sách phòng:', err.message);
        listContainer.innerHTML = `<p style="text-align:center; color: red;">Lỗi tải dữ liệu. Hãy tải lại trang.</p>`;
    }
}

// Hiển thị ra màn hình
function renderDirtyRooms(rooms) {
    const listContainer = document.getElementById('dirtyRoomsList');
    let html = '';
    
    rooms.forEach(room => {
        let timeStr = timeAgo(room.lastCheckout);
        html += `
            <div class="dirty-room-card" onclick="openConfirmModal(${room.id}, '${room.room_name}')">
                <div class="room-info">
                    <h2>Phòng ${room.room_name}</h2>
                    <div class="time-ago">Khách trả: <span>${timeStr}</span></div>
                </div>
                <div class="action-icon">✓</div>
            </div>
        `;
    });
    
    listContainer.innerHTML = html;
}

// Xử lý Modal xác nhận
function openConfirmModal(roomId, roomName) {
    selectedRoomId = roomId;
    document.getElementById('modalRoomTitle').innerText = `Phòng ${roomName}`;
    document.getElementById('confirmCleanModal').style.display = 'flex';
}

function closeConfirmModal() {
    selectedRoomId = null;
    document.getElementById('confirmCleanModal').style.display = 'none';
}

// Đổi trạng thái sang 'trong' khi bấm "Đã dọn sạch"
async function executeCleanRoom() {
    if (!selectedRoomId) return;

    try {
        const { error } = await supabaseClient
            .from('rooms')
            .update({ status: 'trong' })
            .eq('id', selectedRoomId);

        if (error) throw error;

        closeConfirmModal();
        fetchDirtyRooms(); // Load lại danh sách ngay lập tức
    } catch (err) {
        alert('Lỗi cập nhật: ' + err.message);
    }
}

// Tự động load dữ liệu mỗi 30 giây để cập nhật phòng bẩn mới
fetchDirtyRooms();
setInterval(fetchDirtyRooms, 10000);