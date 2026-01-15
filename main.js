const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const axios = require('axios');
require('ejs-electron');

const API_BASE_URL = 'http://blockteam.kro.kr:32828/BlockTeam-Data';

let mainWindow;
let currentDoctorId = null;
let currentPatient = null;
let currentUserRole = 'doctor'; 

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 1080,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    title: "BlockTeam HIS",
    backgroundColor: '#2f3136',
    icon: path.join(__dirname, 'assets', 'icon.png') 
  });
  mainWindow.loadURL('file://' + __dirname + '/views/login.ejs');
}

app.whenReady().then(createWindow);

// 1. 로그인
ipcMain.on('request-login', async (event, creds) => {
    try {
        const res = await axios.post(`${API_BASE_URL}/login`, creds);
        if (res.data.success) {
            currentDoctorId = creds.id;
            currentUserRole = res.data.role || 'doctor';
            const targetPage = res.data.role === 'admin' ? 'admin.ejs' : 'selection.ejs';
            mainWindow.loadURL('file://' + __dirname + '/views/' + targetPage);
        } else {
            event.reply('login-failed', res.data.message);
        }
    } catch (e) { event.reply('login-failed', '서버 연결 실패'); }
});

// 2. 메타데이터 요청
ipcMain.on('request-metadata', async (event) => {
    try {
        const res = await axios.get(`${API_BASE_URL}/meta-data`);
        event.reply('receive-metadata', res.data);
    } catch (e) {}
});

// 3. 환자 선택 -> 차트 페이지 이동
ipcMain.on('patient-selected', (event, patient) => {
    currentPatient = patient;
    mainWindow.loadURL('file://' + __dirname + '/views/index.ejs');
    mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.send('init-patient-data', currentPatient);
        mainWindow.webContents.send('init-user-role', currentUserRole);
    });
});

// 4. 새로고침 대응
ipcMain.on('request-patient-data', (event) => {
    if (currentPatient) {
        event.reply('init-patient-data', currentPatient);
        event.reply('init-user-role', currentUserRole);
    }
});

// 5. 저장 요청
ipcMain.on('save-soap-signed', async (event, payload) => {
    if (currentUserRole === 'viewer') {
        event.reply('save-failed', '권한이 없습니다.');
        return;
    }
    try {
        const requestData = {
            soapData: payload.soapData,
            signature: "Signed by " + currentDoctorId,
            doctorId: currentDoctorId,
            patientId: currentPatient.id
        };
        const res = await axios.post(`${API_BASE_URL}/Chart`, requestData);
        if (res.data.success) event.reply('save-success', '✅ 저장되었습니다.');
        else event.reply('save-failed', res.data.message);
    } catch (e) { event.reply('save-failed', '서버 통신 오류'); }
});

// 6. 기록 불러오기
ipcMain.on('request-history', async (event, patientId) => {
    try {
        const pid = patientId || (currentPatient ? currentPatient.id : null);
        if(!pid) return;
        const res = await axios.get(`${API_BASE_URL}/Chart?patientId=${pid}`);
        event.reply('load-history', res.data);
    } catch (e) {}
});

// 7. 관리자 기능
ipcMain.on('admin-add-dept', async (e, d) => { await axios.post(`${API_BASE_URL}/admin/department`, d); e.reply('action-result','완료'); });
ipcMain.on('admin-add-patient', async (e, d) => { await axios.post(`${API_BASE_URL}/admin/patient`, d); e.reply('action-result','완료'); });
ipcMain.on('admin-add-user', async (e, d) => { await axios.post(`${API_BASE_URL}/admin/user`, d); e.reply('action-result','완료'); });
ipcMain.on('admin-get-charts', async (e) => { const res = await axios.get(`${API_BASE_URL}/Chart`); e.reply('admin-charts-data', res.data); });
ipcMain.on('admin-delete-chart', async (e, id) => { await axios.delete(`${API_BASE_URL}/Chart/${id}`); e.reply('action-result', '삭제됨'); });

// ★ [수정됨] 담당의 변경 (배정 해제 처리 추가)
ipcMain.on('admin-update-patient', async (e, data) => {
    try {
        // 1. 서버 DB 업데이트
        await axios.put(`${API_BASE_URL}/admin/patient`, data); 
        
        // 2. 현재 켜져있는 환자 정보 동기화
        if (currentPatient && currentPatient.id === data.id) {
            // 'unassigned'면 빈 값으로 변경, 아니면 해당 ID로 변경
            const newDocId = (data.inChargeId === 'unassigned') ? '' : data.inChargeId;
            currentPatient.inChargeId = newDocId;
            
            if (mainWindow) {
                mainWindow.webContents.send('init-patient-data', currentPatient);
            }
        }

        e.reply('action-result', '담당의 변경 완료');
    } catch (err) {
        e.reply('action-result', '변경 실패: ' + err.message);
    }
});