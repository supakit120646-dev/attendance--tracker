// System Variables ---
const pages = ['page-login', 'page-register-data', 'page-register-scan', 'page-dashboard']
let tempUserData = {} 
let currentUser = null 
let faceMatcher = null
let scanInterval = null
let isScanning = false
let selectedAction = '' 
let myLocation = null
let isModelLoaded = false 

// Load AI Models ---
Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri('./models'),
    faceapi.nets.faceLandmark68Net.loadFromUri('./models'),
    faceapi.nets.faceRecognitionNet.loadFromUri('./models')
]).then(() => {
    console.log("AI Models Loaded")
    isModelLoaded = true
    const statusText = document.getElementById('ai-loading-status')
    const btn = document.getElementById('btn-start-reg-scan')
    if(statusText) { statusText.innerText = "พร้อมทำงานแล้ว"; statusText.style.color = "var(--success)"; }
    if(btn) { btn.disabled = false; btn.innerHTML = "เริ่มสแกนใบหน้า"; btn.style.opacity = "1"; }
})

// --- Popup ---
window.showPopup = function(type, title, message) {
    const popup = document.getElementById('custom-popup')
    const box = popup.querySelector('.popup-content-box')
    const icon = document.getElementById('popup-icon')
    
    box.className = 'popup-content-box'
    
    if (type === 'success') { 
        box.classList.add('popup-success'); 
        icon.innerText = '✅'; 
    } else if (type === 'loading') { 
        box.classList.add('popup-loading'); 
        icon.innerText = '⏳'; 
    } else { 
        box.classList.add('popup-error'); 
        icon.innerText = '❌'; 
    }
    
    document.getElementById('popup-title').innerText = title
    document.getElementById('popup-message').innerText = message
    popup.classList.add('active')
}

window.closePopup = function() {
    document.getElementById('custom-popup').classList.remove('active')
}

// --- Navigation ---
window.goToPage = function(pageId) {
    pages.forEach(p => document.getElementById(p).classList.remove('active'))
    document.getElementById(pageId).classList.add('active')
    stopCamera() 

    if (pageId === 'page-login') {
        document.getElementById('loginUsername').value = ''
        document.getElementById('loginPassword').value = ''
        document.getElementById('regFirstName').value = ''
        document.getElementById('regLastName').value = ''
        document.getElementById('regUsername').value = ''
        document.getElementById('regPassword').value = ''
    }
}

function stopCamera() {
    document.querySelectorAll('video').forEach(v => {
        if(v.srcObject) {
            v.srcObject.getTracks().forEach(track => track.stop())
            v.srcObject = null
        }
    })
}

function parseDescriptors(data) {
    if (!data) return [];
    if (typeof data === 'string') return JSON.parse(data);
    return data;
}

// --- Login ---
window.handleLogin = async function() {
    const userIn = document.getElementById('loginUsername').value
    const passIn = document.getElementById('loginPassword').value
    
    showPopup('loading', 'กรุณารอ', 'กำลังตรวจสอบข้อมูลกับ Server...')

    try {
        if(!window.supabase) throw "Supabase not ready"
        
        // ดึงข้อมูลผู้ใช้จากตาราง users ที่มี username ตรงกัน
        const { data: users, error } = await window.supabase
            .from('users')
            .select('*')
            .eq('username', userIn)

        if (error) throw error

        // ตรวจสอบรหัสผ่าน
        let foundUser = users && users.length > 0 && users[0].password === passIn ? users[0] : null

        if (foundUser) {
            currentUser = foundUser
            await loadFaceMatcher() 
            
            if (navigator.geolocation) {
                navigator.geolocation.watchPosition(pos => {
                    myLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude }
                })
            }
            
            closePopup()
            showPopup('success', 'สำเร็จ', `ยินดีต้อนรับคุณ ${foundUser.firstName}`)
            goToPage('page-dashboard')
            document.getElementById('welcome-msg').innerText = `สวัสดี: ${foundUser.firstName} ${foundUser.lastName}`
        } else {
            showPopup('error', 'ไม่สำเร็จ', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
        }
    } catch (e) {
        console.error(e)
        showPopup('error', 'Error', 'เชื่อมต่อฐานข้อมูลไม่ได้ หรือ ขาดการเชื่อมต่ออินเทอร์เน็ต')
    }
}

window.handleLogout = function() {
    currentUser = null
    selectedAction = ''
    goToPage('page-login')
}

// --- Register Data ---
window.validateAndGoToScan = async function() {
    const fname = document.getElementById('regFirstName').value
    const lname = document.getElementById('regLastName').value
    const user = document.getElementById('regUsername').value
    const pass = document.getElementById('regPassword').value

    if (!fname || !lname || !user || !pass) return showPopup('error', 'ข้อมูลไม่ครบ', 'กรุณากรอกให้ครบ')

    const btn = document.querySelector("button[onclick='validateAndGoToScan()']") 
    if(btn) { btn.innerHTML = "⏳ ตรวจสอบ User..."; btn.disabled = true; }

   try {
    const { data, error } = await window.supabase
        .from('users')
        .select('username')
        .eq('username', user)

    if (error) throw error
    
    if (data && data.length > 0) {
        if(btn) { btn.innerHTML = "บันทึกใบหน้า"; btn.disabled = false; }
        return showPopup('error', 'ซ้ำ', 'รหัสพนักงานนี้มีในระบบแล้ว')
    }

        if(btn) { btn.innerHTML = "⏳ ขอพิกัด GPS..." }
        const gpsOptions = { enableHighAccuracy: true, timeout: 30000, maximumAge: 60000 };

        navigator.geolocation.getCurrentPosition(position => {
            tempUserData = { 
                firstName: fname, lastName: lname, username: user, password: pass, 
                descriptors: [], 
                officeLat: position.coords.latitude, officeLon: position.coords.longitude
            }
            
            if(btn) { btn.innerHTML = "บันทึกใบหน้า"; btn.disabled = false; }
            resetRegisterUI() 
            goToPage('page-register-scan')

        }, (error) => {
            showPopup('error', 'GPS Error', 'หาพิกัดไม่ได้ (กรุณาเปิด GPS/Wi-Fi)')
            if(btn) { btn.innerHTML = "ลองใหม่"; btn.disabled = false; }
        }, gpsOptions)

    } catch (e) {
        console.error(e)
        showPopup('error', 'Error', 'เกิดข้อผิดพลาดในการเชื่อมต่อ')
        if(btn) btn.disabled = false;
    }
}

// --- Register Scan ---
let collectedDescriptors = []
let scanProgress = 0

async function startCamera(videoId) {
    const video = document.getElementById(videoId)
    stopCamera() 
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } } 
        })
        video.srcObject = stream
        video.onloadedmetadata = () => { video.play() }
    } catch (err) { showPopup('error', 'Camera', 'เปิดกล้องไม่ได้') }
}

window.startFaceScanProcess = async function() {
    if (!isModelLoaded) return showPopup('error', 'รอสักครู่', 'กำลังโหลด...')
    
    const btn = document.getElementById('btn-start-reg-scan')
    const video = document.getElementById('video-scan')
    
    if(btn) { btn.innerHTML = "📷 กำลังเปิดกล้อง..."; btn.disabled = true; }

    const stream = video.srcObject;
    if (!stream || !stream.active) { 
        await startCamera('video-scan')
        await new Promise(r => setTimeout(r, 1000))
    }

    const ui = document.getElementById('scan-ui')
    const percentText = document.getElementById('scan-percent')
    const ring = document.querySelector('.scanner-ring')
    
    if(btn) btn.style.display = 'none'
    ui.classList.remove('hidden')
    
    collectedDescriptors = []
    scanProgress = 0
    isScanning = true

    scanInterval = setInterval(async () => {
        if (!isScanning) return
        try {
            const detection = await faceapi.detectSingleFace(video).withFaceLandmarks().withFaceDescriptor()
            if (detection) {
                scanProgress += 20 
                percentText.innerText = `${scanProgress}%`
                ring.style.borderColor = "var(--primary)"
                collectedDescriptors.push(Array.from(detection.descriptor))
                if (scanProgress >= 100) finishRegistration()
            } else {
                ring.style.borderColor = "var(--error)"
            }
        } catch(e) {}
    }, 800)
}

async function finishRegistration() {
    clearInterval(scanInterval)
    isScanning = false
    
    showPopup('loading', 'รอสักครู่', 'กำลังบันทึกลงฐานข้อมูล...')
    
    const duplicateUser = await checkDuplicateFace(collectedDescriptors)
    if (duplicateUser) {
        closePopup()
        showPopup('error', 'ไม่ผ่าน', `ใบหน้านี้มีในระบบแล้ว (${duplicateUser})`)
        resetRegisterUI()
        goToPage('page-register-data')
        return
    }


    const finalUser = { 
        ...tempUserData, 
        descriptors: JSON.stringify(collectedDescriptors) 
    }

    
try {
    const { error } = await window.supabase
        .from('users')
        .insert([finalUser])

    if (error) throw error
    
    closePopup()
    showPopup('success', 'สำเร็จ', 'ลงทะเบียนเรียบร้อย')
    resetRegisterUI()
    goToPage('page-login')
} catch (e) {
    console.error(e)
    showPopup('error', 'Error', `บันทึกไม่สำเร็จ: ${e.message}`)
}
}

window.stopScanAndBack = function() {
    resetRegisterUI()
    goToPage('page-register-data')
}

function resetRegisterUI() {
    scanProgress = 0
    collectedDescriptors = []
    isScanning = false
    clearInterval(scanInterval)

    const percentText = document.getElementById('scan-percent')
    const ring = document.querySelector('.scanner-ring')
    const ui = document.getElementById('scan-ui')
    const btn = document.getElementById('btn-start-reg-scan')

    if(percentText) percentText.innerText = "0%"
    if(ring) ring.style.borderColor = "rgba(255,255,255,0.3)"
    if(ui) ui.classList.add('hidden')
    if(btn) { btn.style.display = 'inline-block'; btn.disabled = false; btn.innerHTML = "เริ่มสแกนใบหน้า"; }
}

// --- Cloud Face Matching  ---
async function checkDuplicateFace(newFaceDescriptors) {
    try {
        const { data: users, error } = await window.supabase.from('users').select('*')
        if (error || !users || users.length === 0) return null

        const labeledDescriptors = users.map(user => {
            const descriptors = parseDescriptors(user.descriptors);
            return new faceapi.LabeledFaceDescriptors(user.username, descriptors.map(d => new Float32Array(d)))
        })
        const faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.5)

        for (const descriptor of newFaceDescriptors) {
            const bestMatch = faceMatcher.findBestMatch(new Float32Array(descriptor))
            if (bestMatch.label !== 'unknown') return bestMatch.label
        }
        return null
    } catch (e) { return null }
}

async function loadFaceMatcher() {
    try {
        const { data: users, error } = await window.supabase.from('users').select('*')
        if (error || !users) return

        const labeledDescriptors = users.map(user => {
            const descriptors = parseDescriptors(user.descriptors);
            return new faceapi.LabeledFaceDescriptors(user.username, descriptors.map(d => new Float32Array(d)))
        })
        if (labeledDescriptors.length > 0) faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.5)
    } catch(e) { console.error("Error loading matcher", e) }
}

// --- Attendance ---
window.openScanner = function(action) {
    selectedAction = action
    document.getElementById('scan-title').innerText = `ยืนยัน: ${action}`
    document.getElementById('camera-placeholder').classList.remove('hidden')
    document.getElementById('video-auth').classList.add('hidden')
    document.getElementById('btn-scan-confirm').classList.add('hidden')
    document.getElementById('modal-scanner').classList.add('active')
}

window.startAuthCamera = async function() {
    const video = document.getElementById('video-auth')
    const placeholder = document.getElementById('camera-placeholder')
    const scanBtn = document.getElementById('btn-scan-confirm')

    stopCamera()

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } } 
        })
        video.srcObject = stream
        video.onloadedmetadata = () => { video.play() }

        placeholder.classList.add('hidden')
        video.classList.remove('hidden')
        scanBtn.classList.remove('hidden')
    } catch (err) { showPopup('error', 'Camera', 'เปิดกล้องไม่ได้') }
}

window.closeScanner = function() {
    document.getElementById('modal-scanner').classList.remove('active')
    stopCamera()
}

window.performCheckIn = async function() {
    if (!faceMatcher) return showPopup('error', 'Error', 'AI ไม่พร้อม')
    if (!myLocation) return showPopup('error', 'GPS', 'กำลังหาพิกัด...')
    
    const video = document.getElementById('video-auth')
    const detection = await faceapi.detectSingleFace(video).withFaceLandmarks().withFaceDescriptor()

    if (detection) {
        const bestMatch = faceMatcher.findBestMatch(detection.descriptor)
        if (bestMatch.label === currentUser.username) {
            const dist = getDistanceFromLatLonInKm(myLocation.lat, myLocation.lon, currentUser.officeLat, currentUser.officeLon) * 1000
            
            if (dist <= 200) {
                await saveAttendanceLog(selectedAction)
                showPopup('success', 'สำเร็จ', `${selectedAction}\n(ห่าง ${dist.toFixed(0)} ม.)`)
                closeScanner()
            } else {
                showPopup('error', 'ผิดสถานที่', `อยู่นอกพื้นที่ (${dist.toFixed(0)} ม.)`)
            }
        } else {
            showPopup('error', 'ผิดพลาด', `ใบหน้าไม่ตรงกับบัญชี`)
        }
    } else {
        showPopup('error', 'ไม่พบใบหน้า', 'มองกล้องให้ชัดเจน')
    }
}

async function saveAttendanceLog(action) {
    const now = new Date()
    let status = "ปกติ"
    const hour = now.getHours()
    const minute = now.getMinutes()
    
    if (action.includes("เช้า") && (hour > 9 || (hour === 9 && minute > 0))) status = "สาย"
    if (action.includes("บ่าย") && (hour > 13 || (hour === 13 && minute > 30))) status = "สาย"

    const newLog = {
        username: currentUser.username, 
        fullName: `${currentUser.firstName} ${currentUser.lastName}`,
        date: now.toLocaleDateString('th-TH'),
        time: now.toLocaleTimeString('th-TH'),
        action: action, 
        status: status, 
        timestamp: now.getTime()
    }

    try {
        const { error } = await window.supabase
            .from('logs')
            .insert([newLog])
        if (error) throw error
    } catch (e) { console.error("Save log error", e) }
}

// --- History ---
window.openHistory = async function() {
    document.getElementById('modal-history').classList.add('active')
    const tbody = document.getElementById('history-body')
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">⏳ กำลังโหลดข้อมูล...</td></tr>'

    try {
        // ดึงประวัติจากตาราง logs เรียงตามเวลาล่าสุด
        const { data: logs, error } = await window.supabase
            .from('logs')
            .select('*')
            .eq('username', currentUser.username)
            .order('timestamp', { ascending: false })

        if (error) throw error
        tbody.innerHTML = ''
        
        if (!logs || logs.length === 0) {
             tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;">ไม่พบประวัติ</td></tr>`
             return
        }

        logs.forEach((log) => {
            let badgeClass = log.status === 'สาย' ? 'badge-late' : 'badge-ontime'
            tbody.innerHTML += `<tr><td>${log.date}<br><small>${log.time}</small></td><td>${log.action}</td><td><span class="badge ${badgeClass}">${log.status}</span></td></tr>`
        })

    } catch (e) {
        console.error(e)
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:red;">โหลดไม่สำเร็จ (เช็ค Console)</td></tr>`
    }
}

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  var R = 6371; var dLat = deg2rad(lat2-lat1); var dLon = deg2rad(lon2-lon1); 
  var a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon/2) * Math.sin(dLon/2); 
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); return R * c; 
}
function deg2rad(deg) { return deg * (Math.PI/180) }

setInterval(() => {
    const el = document.getElementById('current-time')
    if(el) el.innerText = new Date().toLocaleTimeString('th-TH')
}, 1000)
