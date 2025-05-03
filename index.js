const smpp = require('smpp');
const express = require('express');
const os = require('os');
const app = express();

// 配置 SMPP 连接参数
const smppConfig = {
    host: '165.84.188.148',
    port: 2775,
    systemId: 'MBC137',
    password: 'qg7Iuhn7'
};

// 创建 SMPP 会话
let session = null;

// 连接 SMPP 服务器
function connectSMPP() {
    console.log('准备连接到 SMPP 服务器，参数:', smppConfig);
    session = smpp.connect({
        url: `smpp://${smppConfig.host}:${smppConfig.port}`,
        auto_enquire_link_period: 10000,
        debug: true
    });

    session.on('connect', () => {
        console.log('已连接到 SMPP 服务器');
        session.bind_transceiver({
            system_id: smppConfig.systemId,
            password: smppConfig.password
        }, (pdu) => {
            console.log('bind_transceiver 回调:', pdu);
            if (pdu.command_status === 0) {
                console.log('SMPP 绑定成功');
            } else {
                console.error('SMPP 绑定失败:', pdu.command_status);
            }
        });
    });

    session.on('error', (error) => {
        console.error('SMPP 连接错误:', error);
    });

    session.on('close', () => {
        console.log('SMPP 连接已关闭');
        // 尝试重新连接
        setTimeout(connectSMPP, 5000);
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