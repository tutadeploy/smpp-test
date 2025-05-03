const smpp = require('smpp');
const express = require('express');
const os = require('os');
const app = express();

// SMPP 状态码映射
const SMPP_STATUS_CODES = {
    0: 'ESME_ROK (No Error)',
    1: 'ESME_RINVMSGLEN (Message Length is invalid)',
    2: 'ESME_RINVCMDLEN (Command Length is invalid)',
    3: 'ESME_RINVCMDID (Invalid Command ID)',
    4: 'ESME_RINVBNDSTS (Incorrect BIND Status for given command)',
    5: 'ESME_RALYBND (ESME Already in Bound State)',
    8: 'ESME_RINVSRCADR (Invalid Source Address)',
    0x0A: 'ESME_RINVPASWD (Invalid Password)',
    0x0B: 'ESME_RINVSYSID (Invalid System ID)',
};

// 配置 SMPP 连接参数
const smppConfig = {
    host: '165.84.188.148',
    port: 2775,
    systemId: 'MBC137',
    password: 'qg7Iuhn7'
};

// 创建 SMPP 会话
let session = null;
let bindRetryCount = 0;
const MAX_BIND_RETRIES = 3;

// 尝试不同的绑定类型
const BIND_TYPES = ['transmitter', 'receiver', 'transceiver'];
let currentBindTypeIndex = 0;

// 清理会话
function cleanupSession() {
    if (session) {
        try {
            console.log('=== 发送 unbind 请求 ===');
            session.unbind();
        } catch (error) {
            console.error('Unbind 错误:', error);
        }
    }
}

// 连接 SMPP 服务器
function connectSMPP() {
    console.log('=== SMPP 连接初始化 ===');
    console.log('连接参数详情:');
    console.log('- 主机:', smppConfig.host);
    console.log('- 端口:', smppConfig.port);
    console.log('- 系统ID:', smppConfig.systemId);
    console.log('- 密码长度:', smppConfig.password.length);
    console.log('- 密码前两位:', smppConfig.password.substring(0, 2));
    console.log('==================');

    // 清理之前的会话
    cleanupSession();

    session = smpp.connect({
        url: `smpp://${smppConfig.host}:${smppConfig.port}`,
        auto_enquire_link_period: 10000,
        debug: true
    });

    session.on('connect', () => {
        console.log('=== SMPP TCP连接已建立 ===');
        tryBind();
    });

    session.on('error', (error) => {
        console.error('=== SMPP 错误事件 ===');
        console.error('错误详情:', error);
        console.error('错误堆栈:', error.stack);
        console.error('==================');
    });

    session.on('close', () => {
        console.log('=== SMPP 连接关闭 ===');
        console.log('准备在5秒后重新连接...');
        console.log('==================');
        setTimeout(connectSMPP, 5000);
    });
    
    session.on('unknown', (pdu) => {
        console.log('=== 收到未知PDU ===');
        console.log('PDU详情:', JSON.stringify(pdu, null, 2));
        console.log('==================');
    });
    
    session.on('enquire_link', (pdu) => {
        console.log('=== 收到enquire_link请求 ===');
        console.log('PDU详情:', JSON.stringify(pdu, null, 2));
        console.log('==================');
    });

    // 添加 unbind 事件处理
    session.on('unbind', (pdu) => {
        console.log('=== 收到 unbind 请求 ===');
        console.log('PDU详情:', JSON.stringify(pdu, null, 2));
        console.log('==================');
    });
}

// 尝试不同的绑定类型
function tryBind() {
    const bindType = BIND_TYPES[currentBindTypeIndex];
    console.log(`尝试绑定类型: ${bindType} (尝试次数: ${bindRetryCount + 1})`);

    const bindParams = {
        system_id: smppConfig.systemId,
        password: smppConfig.password,
        system_type: '',
        interface_version: 0x33,  // 尝试 SMPP 3.3
        addr_ton: 0,
        addr_npi: 0,
        address_range: ''
    };

    console.log('绑定参数:', JSON.stringify(bindParams, null, 2));

    const bindFunction = session[`bind_${bindType}`].bind(session);
    
    bindFunction(bindParams, (pdu) => {
        console.log('=== 收到绑定响应 ===');
        console.log('完整PDU内容:', JSON.stringify(pdu, null, 2));
        
        const statusCode = pdu.command_status;
        const statusMessage = SMPP_STATUS_CODES[statusCode] || `未知状态码: ${statusCode}`;
        
        if (statusCode === 0) {
            console.log('SMPP 绑定成功');
            console.log('- 绑定类型:', bindType);
            console.log('- 服务器分配的系统ID:', pdu.system_id);
            bindRetryCount = 0;
            currentBindTypeIndex = 0;
        } else {
            console.error('SMPP 绑定失败');
            console.error('- 错误状态码:', statusCode);
            console.error('- 错误描述:', statusMessage);
            console.error('- 服务器返回的系统ID:', pdu.system_id);
            console.error('- 命令ID:', pdu.command_id);
            console.error('- 序列号:', pdu.sequence_number);
            
            // 尝试下一个绑定类型或重试
            bindRetryCount++;
            if (bindRetryCount >= MAX_BIND_RETRIES) {
                bindRetryCount = 0;
                currentBindTypeIndex = (currentBindTypeIndex + 1) % BIND_TYPES.length;
            }
            
            // 关闭连接，触发重连
            session.close();
        }
        console.log('==================');
    });
}

// 发送短信函数
async function sendSMS(destination, message) {
    return new Promise((resolve, reject) => {
        if (!session) {
            reject(new Error('SMPP 会话未建立'));
            return;
        }

        session.submit_sm({
            destination_addr: destination,
            short_message: message,
            data_coding: 8, // UCS2 编码，支持中文
            source_addr: smppConfig.systemId
        }, (pdu) => {
            if (pdu.command_status === 0) {
                resolve({ 
                    success: true, 
                    messageId: pdu.message_id,
                    phone: destination
                });
            } else {
                reject(new Error(`发送失败，状态码: ${pdu.command_status}`));
            }
        });
    });
}

// 批量发送短信函数
async function sendBulkSMS(phones, message) {
    const results = [];
    const errors = [];

    for (const phone of phones) {
        try {
            const result = await sendSMS(phone, message);
            results.push(result);
        } catch (error) {
            errors.push({
                phone,
                error: error.message
            });
        }
    }

    return {
        success: results.length > 0,
        results,
        errors
    };
}

// 初始化 SMPP 连接
connectSMPP();

// 创建 Express 服务器
app.use(express.json());

// 发送短信的 API 端点
app.post('/send-sms', async (req, res) => {
    try {
        const { phones, message } = req.body;
        
        if (!phones || !message) {
            return res.status(400).json({ 
                success: false, 
                error: '请提供手机号和短信内容' 
            });
        }

        // 确保 phones 是数组
        const phoneList = Array.isArray(phones) ? phones : [phones];
        
        const result = await sendBulkSMS(phoneList, message);
        res.json(result);
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 启动服务器
const PORT = 3000;

function getPublicIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('10.') && !iface.address.startsWith('192.168.') && !iface.address.startsWith('172.')) {
                return iface.address;
            }
        }
    }
    return '0.0.0.0';
}

app.listen(PORT, '0.0.0.0', () => {
    const publicIP = getPublicIP();
    console.log(`短信服务器运行在 http://${publicIP}:${PORT}`);
}); 