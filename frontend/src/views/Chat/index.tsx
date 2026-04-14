import { useState, useRef, useCallback } from 'react';
import { Input, Button, Card, Tabs, Spin, message, Typography, Space, Tag } from 'antd';
import { SendOutlined, CopyOutlined, CheckOutlined, ReloadOutlined } from '@ant-design/icons';
import AmisRenderer from '../../components/AmisRenderer';
import { createHistory, adoptHistory } from '../../services/generation';

const { TextArea } = Input;
const { Text } = Typography;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  amisJson?: string;
  modelUsed?: string;
  historyId?: number;
  adopted?: boolean;
  loading?: boolean;
}

export default function Chat() {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [generating, setGenerating] = useState(false);
  const [currentJson, setCurrentJson] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('preview');
  const abortRef = useRef<AbortController | null>(null);

  const handleSend = useCallback(async () => {
    const prompt = inputValue.trim();
    if (!prompt || generating) return;

    setInputValue('');
    setGenerating(true);

    // 添加用户消息
    const userMsg: ChatMessage = { role: 'user', content: prompt };
    const assistantMsg: ChatMessage = { role: 'assistant', content: '', loading: true };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const resp = await fetch('/agent/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, stream: true }),
        signal: abortController.signal,
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const reader = resp.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let modelUsed = '';
      let doneHandled = false;

      const processLine = async (line: string) => {
        if (!line.startsWith('data: ')) return;

        const dataStr = line.slice(6);
        try {
          const data = JSON.parse(dataStr);

          if (data.model) {
            modelUsed = data.model;
            return;
          }
          if (data.error) {
            message.error(data.error);
            doneHandled = true;
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: 'assistant',
                content: `生成失败: ${data.error}`,
                loading: false,
              };
              return updated;
            });
            return;
          }
          if (data.amis_json !== undefined) {
            // 最终结果
            doneHandled = true;
            const amisJson = data.amis_json || fullContent;
            setCurrentJson(amisJson);
            fullContent = data.raw_content || fullContent;
            modelUsed = data.model_used || modelUsed;

            // 自动保存到历史记录
            let historyId: number | undefined;
            try {
              const saved = await createHistory({
                user_prompt: prompt,
                generated_json: amisJson,
                model_used: modelUsed || undefined,
              });
              historyId = saved.id;
            } catch { /* 保存失败不影响体验 */ }

            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: 'assistant',
                content: '已为您生成 amis 页面配置',
                amisJson,
                modelUsed,
                historyId,
                loading: false,
              };
              return updated;
            });
            return;
          }
          if (data.content) {
            fullContent = data.full || (fullContent + data.content);
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: 'assistant',
                content: fullContent,
                loading: true,
              };
              return updated;
            });
          }
        } catch {
          // 忽略无法解析的行
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event:')) continue;
          await processLine(line);
        }
      }

      // 处理 buffer 中残留的数据
      if (buffer.trim()) {
        for (const line of buffer.split('\n')) {
          if (line.startsWith('event:')) continue;
          await processLine(line);
        }
      }

      // 兜底：流结束但 done 事件未被处理
      if (!doneHandled && fullContent) {
        const amisJson = fullContent;
        setCurrentJson(amisJson);

        let historyId: number | undefined;
        try {
          const saved = await createHistory({
            user_prompt: prompt,
            generated_json: amisJson,
            model_used: modelUsed || undefined,
          });
          historyId = saved.id;
        } catch { /* 保存失败不影响体验 */ }

        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: 'assistant',
            content: '已为您生成 amis 页面配置',
            amisJson,
            modelUsed,
            historyId,
            loading: false,
          };
          return updated;
        });
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      message.error(`生成失败: ${err.message}`);
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: `生成失败: ${err.message}`,
          loading: false,
        };
        return updated;
      });
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }, [inputValue, generating]);

  const handleAdopt = useCallback(async (msgIndex: number) => {
    const msg = messages[msgIndex];
    if (!msg?.historyId || !msg.amisJson) return;
    try {
      await adoptHistory(msg.historyId, { final_json: msg.amisJson });
      setMessages((prev) => {
        const updated = [...prev];
        updated[msgIndex] = { ...updated[msgIndex], adopted: true };
        return updated;
      });
      message.success('已采纳，加入知识库！下次生成会更智能');
    } catch {
      message.error('采纳失败');
    }
  }, [messages]);

  const handleCopyJson = () => {
    if (currentJson) {
      navigator.clipboard.writeText(
        typeof currentJson === 'string' ? currentJson : JSON.stringify(currentJson, null, 2)
      );
      message.success('已复制到剪贴板');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const parsedSchema = (() => {
    if (!currentJson) return null;
    try {
      return typeof currentJson === 'string' ? JSON.parse(currentJson) : currentJson;
    } catch {
      return null;
    }
  })();

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 140px)', gap: 16 }}>
      {/* 左栏：对话面板 */}
      <div style={{ width: '40%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#999' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🤖</div>
              <Text type="secondary" style={{ fontSize: 16 }}>
                描述你想要的页面，AI 帮你生成 amis 配置
              </Text>
              <div style={{ marginTop: 16, textAlign: 'left', maxWidth: 300, margin: '16px auto 0' }}>
                <Text type="secondary">试试这些：</Text>
                <ul style={{ color: '#666', marginTop: 8 }}>
                  <li style={{ cursor: 'pointer', color: '#667eea' }} onClick={() => setInputValue('帮我做一个用户管理的 CRUD 页面，包含姓名、手机号、邮箱、状态字段')}>
                    用户管理 CRUD 页面
                  </li>
                  <li style={{ cursor: 'pointer', color: '#667eea', marginTop: 4 }} onClick={() => setInputValue('做一个登录表单，包含用户名、密码、验证码和记住我选项')}>
                    登录表单页面
                  </li>
                  <li style={{ cursor: 'pointer', color: '#667eea', marginTop: 4 }} onClick={() => setInputValue('做一个数据仪表盘，包含4个统计卡片和一个折线图')}>
                    数据仪表盘
                  </li>
                </ul>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                marginBottom: 12,
              }}
            >
              <Card
                size="small"
                style={{
                  maxWidth: '85%',
                  background: msg.role === 'user' ? '#667eea' : '#f5f5f5',
                  color: msg.role === 'user' ? '#fff' : undefined,
                  borderRadius: 12,
                }}
                styles={{ body: { padding: '8px 12px' } }}
              >
                {msg.loading ? (
                  <Space>
                    <Spin size="small" />
                    <Text style={{ color: '#999' }}>生成中...</Text>
                  </Space>
                ) : (
                  <>
                    <div style={{ color: msg.role === 'user' ? '#fff' : undefined }}>
                      {msg.content}
                    </div>
                    {msg.amisJson && (
                      <div style={{ marginTop: 8 }}>
                        <Space wrap>
                          <Tag color="green">生成完成</Tag>
                          {msg.modelUsed && <Tag>{msg.modelUsed}</Tag>}
                          {msg.adopted ? (
                            <Tag color="success" icon={<CheckOutlined />}>已采纳</Tag>
                          ) : msg.historyId ? (
                            <Button size="small" type="primary" ghost icon={<CheckOutlined />} onClick={() => handleAdopt(i)}>
                              采纳入库
                            </Button>
                          ) : null}
                        </Space>
                      </div>
                    )}
                  </>
                )}
              </Card>
            </div>
          ))}
        </div>

        {/* 输入框 */}
        <div style={{ display: 'flex', gap: 8 }}>
          <TextArea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述你想要的页面..."
            autoSize={{ minRows: 2, maxRows: 4 }}
            disabled={generating}
            style={{ flex: 1 }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSend}
            loading={generating}
            style={{ height: 'auto', minHeight: 52 }}
          >
            发送
          </Button>
        </div>
      </div>

      {/* 右栏：预览面板 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            size="small"
            items={[
              { key: 'preview', label: '预览' },
              { key: 'json', label: 'JSON' },
            ]}
            style={{ marginBottom: 0 }}
          />
          {currentJson && (
            <Space>
              <Button size="small" icon={<CopyOutlined />} onClick={handleCopyJson}>
                复制 JSON
              </Button>
            </Space>
          )}
        </div>

        <Card
          style={{ flex: 1, overflow: 'auto' }}
          styles={{ body: { height: '100%', padding: activeTab === 'preview' ? 0 : 16 } }}
        >
          {!currentJson ? (
            <div style={{ textAlign: 'center', padding: '80px 0', color: '#ccc' }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>📄</div>
              <Text type="secondary">生成的 amis 页面将在这里预览</Text>
            </div>
          ) : activeTab === 'preview' ? (
            parsedSchema ? (
              <AmisRenderer schema={parsedSchema} style={{ padding: 16 }} />
            ) : (
              <div style={{ color: 'red', padding: 16 }}>JSON 解析失败，请检查生成结果</div>
            )
          ) : (
            <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {typeof currentJson === 'string'
                ? (() => { try { return JSON.stringify(JSON.parse(currentJson), null, 2); } catch { return currentJson; } })()
                : JSON.stringify(currentJson, null, 2)}
            </pre>
          )}
        </Card>
      </div>
    </div>
  );
}
