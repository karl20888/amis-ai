import { useRef, useState, useCallback } from 'react';
import { Button, Card, Tabs, message, Typography, Space, Tag } from 'antd';
import { CopyOutlined, CheckOutlined } from '@ant-design/icons';
import { ProChat, ChatMessage } from '@ant-design/pro-chat';
import AmisRenderer from '../../components/AmisRenderer';
import { createHistory, adoptHistory } from '../../services/generation';

const { Text } = Typography;

/**
 * 把后端自定义 SSE 转换为纯文本流（ProChat 直接读原始字节，不解析 SSE 格式）。
 * 同时从流中提取 amis_json、model_used 等元信息。
 */
function transformSSEStream(
  originalBody: ReadableStream<Uint8Array>,
  resultRef: React.MutableRefObject<{
    amisJson: string;
    modelUsed: string;
  } | null>,
): ReadableStream<Uint8Array> {
  const reader = originalBody.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let sseBuffer = '';

  return new ReadableStream({
    async pull(controller) {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (sseBuffer.trim()) {
            processSSELines(sseBuffer.split('\n'), controller, encoder, resultRef);
          }
          controller.close();
          return;
        }

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';

        const hasOutput = processSSELines(lines, controller, encoder, resultRef);
        if (hasOutput) return; // 有输出则让 ProChat 消费
      }
    },
  });
}

function processSSELines(
  lines: string[],
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  resultRef: React.MutableRefObject<{ amisJson: string; modelUsed: string } | null>,
): boolean {
  let hasOutput = false;
  for (const line of lines) {
    if (line.startsWith('event:') || !line.startsWith('data: ')) continue;
    const dataStr = line.slice(6);
    try {
      const data = JSON.parse(dataStr);
      // 流式内容 → 直接输出纯文本（ProChat 按原始字节读取）
      if (data.content) {
        controller.enqueue(encoder.encode(data.content));
        hasOutput = true;
      }
      // 最终结果
      if (data.amis_json !== undefined) {
        resultRef.current = {
          amisJson: data.amis_json,
          modelUsed: data.model_used || '',
        };
      }
      // meta 事件
      if (data.model && !data.content) {
        resultRef.current = {
          ...(resultRef.current || { amisJson: '', modelUsed: '' }),
          modelUsed: data.model,
        };
      }
    } catch {
      // 忽略无法解析的行
    }
  }
  return hasOutput;
}

export default function Chat() {
  const [currentJson, setCurrentJson] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('preview');
  const pendingResultRef = useRef<{ amisJson: string; modelUsed: string } | null>(null);
  const extraDataRef = useRef<Map<string, { historyId?: number; adopted?: boolean; prompt?: string }>>(new Map());
  const lastPromptRef = useRef('');

  const handleCopyJson = () => {
    if (currentJson) {
      navigator.clipboard.writeText(
        typeof currentJson === 'string' ? currentJson : JSON.stringify(currentJson, null, 2),
      );
      message.success('已复制到剪贴板');
    }
  };

  const handleAdopt = useCallback(async (messageId: string) => {
    const extra = extraDataRef.current.get(messageId);
    if (!extra?.historyId) return;
    const amisJson = currentJson;
    if (!amisJson) return;
    try {
      await adoptHistory(extra.historyId, { final_json: amisJson });
      extraDataRef.current.set(messageId, { ...extra, adopted: true });
      message.success('已采纳，加入知识库！下次生成会更智能');
    } catch {
      message.error('采纳失败');
    }
  }, [currentJson]);

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
      {/* 左栏：ProChat 对话面板 */}
      <div style={{ width: '40%', display: 'flex', flexDirection: 'column' }}>
        <ProChat
          helloMessage="描述你想要的页面，AI 帮你生成 amis 配置"
          placeholder="描述你想要的页面..."
          markdownProps={{
            components: {
              // 覆盖默认的 shiki 代码块（shiki 的 WASM 加载经常失败导致空白），用简单的 <pre> 替代
              pre: ({ children }: any) => (
                <pre style={{
                  background: '#f6f8fa',
                  padding: 12,
                  borderRadius: 8,
                  overflow: 'auto',
                  maxHeight: 400,
                  fontSize: 13,
                  lineHeight: 1.6,
                }}>
                  {children}
                </pre>
              ),
            },
          }}
          request={async (messages: ChatMessage[]) => {
            const history = messages.slice(0, -1).map((m) => ({
              role: m.role as string,
              content: typeof m.content === 'string' ? m.content : '',
            }));
            const lastMsg = messages[messages.length - 1];
            const prompt = typeof lastMsg.content === 'string' ? lastMsg.content : '';
            lastPromptRef.current = prompt;
            pendingResultRef.current = null;

            const resp = await fetch('/agent/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt, stream: true, history }),
            });

            if (!resp.ok || !resp.body) {
              throw new Error(`生成失败: HTTP ${resp.status}`);
            }

            // 转换 SSE 流为纯文本流
            const transformedStream = transformSSEStream(resp.body, pendingResultRef);
            return new Response(transformedStream);
          }}
          onChatEnd={async (id: string) => {
            const result = pendingResultRef.current;
            if (!result?.amisJson) return;

            setCurrentJson(result.amisJson);

            try {
              const saved = await createHistory({
                user_prompt: lastPromptRef.current,
                generated_json: result.amisJson,
                model_used: result.modelUsed || undefined,
              });
              extraDataRef.current.set(id, {
                historyId: saved.id,
                adopted: false,
                prompt: lastPromptRef.current,
              });
            } catch {
              // 保存失败不影响体验
            }
          }}
          messageItemExtraRender={(msg: ChatMessage, type: string) => {
            if (type !== 'assistant') return null;
            const extra = extraDataRef.current.get(msg.id);
            if (!extra) return null;

            return (
              <div style={{ marginTop: 4 }}>
                <Space wrap size={4}>
                  <Tag color="green">生成完成</Tag>
                  {extra.adopted ? (
                    <Tag color="success" icon={<CheckOutlined />}>已采纳</Tag>
                  ) : extra.historyId ? (
                    <Button
                      size="small"
                      type="primary"
                      ghost
                      icon={<CheckOutlined />}
                      onClick={() => handleAdopt(msg.id)}
                    >
                      采纳入库
                    </Button>
                  ) : null}
                </Space>
              </div>
            );
          }}
          style={{ height: '100%' }}
        />
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
