import { Component, useMemo } from 'react';
import { render as amisRender } from 'amis';
import 'amis/lib/themes/cxd.css';
import 'amis/lib/helper.css';
import 'amis/sdk/iconfont.css';

interface AmisRendererProps {
  schema: any;
  style?: React.CSSProperties;
}

// ErrorBoundary：捕获 amis 内部 MST 错误，防止整个页面崩溃
class AmisErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  state = { hasError: false, error: '' };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error) {
    console.warn('[AmisRenderer] 渲染出错，已隔离:', error.message);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ color: '#faad14', padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
          <div>amis 预览渲染异常</div>
          <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
            {this.state.error}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// 内部渲染组件，通过 key 强制全新挂载来避免 MST store 复用问题
function AmisRenderInner({ schema }: { schema: any }) {
  try {
    return amisRender(
      schema,
      { data: {} },
      {
        fetcher: ({ url, method, data }: any) => {
          console.log(`[amis] ${method} ${url}`, data);
          return Promise.resolve({
            data: { status: 0, msg: '', data: { items: [], total: 0 } },
          } as any);
        },
        theme: 'cxd',
      }
    ) as React.ReactElement;
  } catch (e) {
    console.error('[AmisRenderer] 渲染失败:', e);
    return <div style={{ color: 'red', padding: 16 }}>渲染失败: {String(e)}</div>;
  }
}

export default function AmisRenderer({ schema, style }: AmisRendererProps) {
  const parsedSchema = useMemo(() => {
    if (!schema) return null;
    try {
      return typeof schema === 'string' ? JSON.parse(schema) : schema;
    } catch {
      return null;
    }
  }, [schema]);

  if (!parsedSchema) {
    return <div style={{ color: '#999', padding: 16 }}>无效的 JSON schema</div>;
  }

  // 用 JSON 序列化作 key，schema 变化时强制销毁旧实例、创建新实例
  const schemaKey = JSON.stringify(parsedSchema);

  return (
    <div style={style}>
      <AmisErrorBoundary key={schemaKey}>
        <AmisRenderInner schema={parsedSchema} />
      </AmisErrorBoundary>
    </div>
  );
}
