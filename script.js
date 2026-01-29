
const pages = ['page-login', 'page-register-data', 'page-register-scan', 'page-dashboard']
let tempUserData = {} 
let currentUser = null 
let faceMatcher = null
let scanInterval = null
let isScanning = false
let selectedAction = '' 
let myLocation = null
let isModelLoaded = false 

// --- Load AI Models ---
Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri('./models'),
    faceapi.nets.faceLandmark68Net.loadFromUri('./models'),
    faceapi.nets.faceRecognitionNet.loadFromUri('./models')
]).then(() => {
    console.log("AI Models Loaded")
    isModelLoaded = true

    const statusText = document.getElementById('ai-loading-status')
    const btn = document.getElementById('btn-start-reg-scan')
    if(statusText) {
        statusText.innerText = "✅ AI พร้อมทำงานแล้ว"
        statusText.style.color = "#34d399"
    }
    if(btn) {
        btn.disabled = false
        btn.innerHTML = "🚀 เริ่มสแกนใบหน้า"
        btn.style.opacity = "1"
        btn.style.cursor = "pointer"
    }
})

// --- Popup ---
function showPopup(type, title, message) {
    const popup = document.getElementById('custom-popup')
    const box = popup.querySelector('.popup-content-box')
    const icon = document.getElementById('popup-icon')
    
    box.className = 'popup-content-box'
    if (type === 'success') {
        box.classList.add('popup-success')
        icon.innerText = '✅'
    } else {
        box.classList.add('popup-error')
        icon.innerText = '❌'
    }
    document.getElementById('popup-title').innerText = title
    document.getElementById('popup-message').innerText = message
    popup.classList.add('active')
}

function closePopup() {
    document.getElementById('custom-popup').classList.remove('active')
}

// --- Navigation ---
function goToPage(pageId) {
    pages.forEach(p => document.getElementById(p).classList.remove('active'))
    document.getElementById(pageId).classList.add('active')
    stopCamera() 
}

function stopCamera() {
    document.querySelectorAll('video').forEach(v => {
        if(v.srcObject) v.srcObject.getTracks().forEach(track => track.stop())
    })
}

// --- Login ---
function handleLogin() {
    const userIn = document.getElementById('loginUsername').value
    const passIn = document.getElementById('loginPassword').value
    
    const users = JSON.parse(localStorage.getItem('users_db')) || []
    const user = users.find(u => u.username === userIn && u.password === passIn)

    if (user) {
        currentUser = user
        loadFaceMatcher() 
        document.getElementById('welcome-msg').innerText = `สวัสดี: ${user.firstName}`
        
        if (navigator.geolocation) {
            navigator.geolocation.watchPosition(pos => {
                myLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude }
            })
        }
        
        showPopup('success', 'เข้าสู่ระบบสำเร็จ', `ยินดีต้อนรับคุณ ${user.firstName} ${user.lastName}`)
        goToPage('page-dashboard')
    } else {
        showPopup('error', 'Login Failed', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
    }
}

function handleLogout() {
    currentUser = null
    selectedAction = '' 
    document.getElementById('loginUsername').value = ''
    document.getElementById('loginPassword').value = ''
    goToPage('page-login')
}

// --- Register  ---
function validateAndGoToScan() {
    const fname = document.getElementById('regFirstName').value
    const lname = document.getElementById('regLastName').value
    const user = document.getElementById('regUsername').value
    const pass = document.getElementById('regPassword').value

    if (!fname || !lname || !user || !pass) return showPopup('error', 'ข้อมูลไม่ครบ', 'กรุณากรอกข้อมูลให้ครบ')

    const users = JSON.parse(localStorage.getItem('users_db')) || []
    if (users.find(u => u.username === user)) return showPopup('error', 'ซ้ำ', 'รหัสพนักงานนี้มีในระบบแล้ว')

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(position => {
            tempUserData = { 
                firstName: fname, 
                lastName: lname, 
                username: user, 
                password: pass, 
                descriptors: [],
                officeLat: position.coords.latitude,
                officeLon: position.coords.longitude
            }
            goToPage('page-register-scan')

            setTimeout(() => { startCamera('video-scan') }, 500)

        }, () => showPopup('error', 'GPS Error', 'กรุณาเปิด GPS'))
    } else {
        showPopup('error', 'Browser Error', 'Browser ไม่รองรับ GPS')
    }
}

// --- Register Scan ---
let collectedDescriptors = []
let scanProgress = 0

async function startCamera(videoId) {
    const video = document.getElementById(videoId)
    if(video.srcObject) video.srcObject.getTracks().forEach(track => track.stop())

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: {} })
        video.srcObject = stream
        video.onloadedmetadata = () => { video.play() } // Force play
    } catch (err) { 
        console.error(err)
        showPopup('error', 'Camera Error', 'ไม่สามารถเปิดกล้องได้')
    }
}

async function startFaceScanProcess() {
    if (!isModelLoaded) return showPopup('error', 'รอสักครู่', 'กำลังโหลดสมอง AI...')

    const video = document.getElementById('video-scan')
    if(video.paused || !video.srcObject) await startCamera('video-scan')

    const ui = document.getElementById('scan-ui')
    const percentText = document.getElementById('scan-percent')
    const ring = document.querySelector('.scanner-ring')
    
    document.getElementById('btn-start-reg-scan').style.display = 'none'
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
                ring.style.borderColor = "#00f7ff" 
                
                collectedDescriptors.push(Array.from(detection.descriptor))

                if (scanProgress >= 100) finishRegistration()
            } else {
                ring.style.borderColor = "#ef4444" 
            }
        } catch(e) { console.log(e) }
    }, 800)
}

function finishRegistration() {
    clearInterval(scanInterval)
    isScanning = false
    
    const users = JSON.parse(localStorage.getItem('users_db')) || []
    const finalUser = { ...tempUserData, descriptors: collectedDescriptors }
    users.push(finalUser)
    localStorage.setItem('users_db', JSON.stringify(users))

    showPopup('success', 'สำเร็จ', 'ลงทะเบียนเรียบร้อย กรุณา Login')
    goToPage('page-login')
}

function stopScanAndBack() {
    clearInterval(scanInterval)
    isScanning = false
    goToPage('page-register-data')
}

// --- Attendance  ---
function openScanner(action) {
    selectedAction = action
    document.getElementById('scan-title').innerText = `ยืนยัน: ${action}`
    
    document.getElementById('camera-placeholder').classList.remove('hidden')
    document.getElementById('video-auth').classList.add('hidden')
    document.getElementById('btn-scan-confirm').classList.add('hidden')
    
    document.getElementById('modal-scanner').classList.add('active')
}

async function startAuthCamera() {
    const video = document.getElementById('video-auth')
    const placeholder = document.getElementById('camera-placeholder')
    const scanBtn = document.getElementById('btn-scan-confirm')

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: {} })
        video.srcObject = stream
        video.onloadedmetadata = () => { video.play() }

        placeholder.classList.add('hidden')
        video.classList.remove('hidden')
        scanBtn.classList.remove('hidden')

    } catch (err) {
        showPopup('error', 'Camera', 'ไม่สามารถเปิดกล้องได้')
    }
}

function closeScanner() {
    document.getElementById('modal-scanner').classList.remove('active')
    stopCamera()
}

async function performCheckIn() {
    if (!faceMatcher) return showPopup('error', 'Error', 'AI ไม่พร้อม')
    if (!myLocation) return showPopup('error', 'GPS', 'กำลังหาพิกัด...')
    
    const video = document.getElementById('video-auth')
    const detection = await faceapi.detectSingleFace(video).withFaceLandmarks().withFaceDescriptor()

    if (detection) {
        const bestMatch = faceMatcher.findBestMatch(detection.descriptor)
        
        if (bestMatch.label === currentUser.username) {
            const dist = getDistanceFromLatLonInKm(myLocation.lat, myLocation.lon, currentUser.officeLat, currentUser.officeLon) * 1000
            
            if (dist <= 200) {
                saveAttendanceLog(selectedAction)
                showPopup('success', 'ลงเวลาสำเร็จ', `${selectedAction}\n(ห่าง ${dist.toFixed(0)} ม.)`)
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

function saveAttendanceLog(action) {
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

    let logs = JSON.parse(localStorage.getItem('attendance_logs')) || []
    logs.unshift(newLog)
    localStorage.setItem('attendance_logs', JSON.stringify(logs))
}

// --- History Viewer ---
function openHistory() {
    document.getElementById('modal-history').classList.add('active')
    const tbody = document.getElementById('history-body')
    tbody.innerHTML = ''

    const allLogs = JSON.parse(localStorage.getItem('attendance_logs')) || []
    const myLogs = allLogs.filter(log => log.username === currentUser.username)

    if (myLogs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;">ไม่พบประวัติ</td></tr>`
        return
    }

    myLogs.forEach(log => {
        let badgeClass = 'badge-ontime'
        if (log.status === 'สาย') badgeClass = 'badge-late'
        tbody.innerHTML += `
            <tr>
                <td>${log.date}<br><small style="color:#94a3b8">${log.time}</small></td>
                <td>${log.action}</td>
                <td><span class="badge ${badgeClass}">${log.status}</span></td>
            </tr>`
    })
}

function loadFaceMatcher() {
    const users = JSON.parse(localStorage.getItem('users_db')) || []
    const labeledDescriptors = users.map(user => {
        const descriptorsArray = user.descriptors.map(d => new Float32Array(d))
        return new faceapi.LabeledFaceDescriptors(user.username, descriptorsArray)
    })
    if (labeledDescriptors.length > 0) {
        faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.6)
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