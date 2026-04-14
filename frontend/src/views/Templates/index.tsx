import { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Tag, Input, Select, Pagination, Empty, Spin, Modal, Tabs, message } from 'antd';
import { EyeOutlined, CopyOutlined } from '@ant-design/icons';
import { getTemplates } from '../../services/generation';
import AmisRenderer from '../../components/AmisRenderer';

const { Search } = Input;

const CATEGORY_OPTIONS = [
  { label: '全部', value: '' },
  { label: 'CRUD', value: 'crud' },
  { label: '表单', value: 'form' },
  { label: '仪表盘', value: 'dashboard' },
  { label: '向导', value: 'wizard' },
  { label: '对话框', value: 'dialog' },
];

const CATEGORY_COLORS: Record<string, string> = {
  crud: 'blue',
  form: 'green',
  dashboard: 'purple',
  wizard: 'orange',
  dialog: 'cyan',
};

const SOURCE_MAP: Record<string, { label: string; color: string }> = {
  official: { label: '官方', color: 'gold' },
  user_adopted: { label: '用户采纳', color: 'green' },
  manual: { label: '手动添加', color: 'default' },
};

interface TemplateItem {
  id: number;
  title: string;
  description: string | null;
  amis_json: string;
  category: string | null;
  source: string;
  quality_score: number | null;
  usage_count: number | null;
  created_at: string;
}

export default function Templates() {
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [previewItem, setPreviewItem] = useState<TemplateItem | null>(null);
  const [previewTab, setPreviewTab] = useState('preview');

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getTemplates({ page, page_size: 12, category: category || undefined, search: search || undefined });
      setItems(data.items);
      setTotal(data.total);
    } catch {
      message.error('获取模板列表失败');
    } finally {
      setLoading(false);
    }
  }, [page, category, search]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleCopy = (json: string) => {
    try {
      navigator.clipboard.writeText(JSON.stringify(JSON.parse(json), null, 2));
    } catch {
      navigator.clipboard.writeText(json);
    }
    message.success('已复制 JSON');
  };

  const getSchema = (item: TemplateItem) => {
    try {
      return typeof item.amis_json === 'string' ? JSON.parse(item.amis_json) : item.amis_json;
    } catch {
      return null;
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>模板库</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <Select
            value={category}
            onChange={(v) => { setCategory(v); setPage(1); }}
            options={CATEGORY_OPTIONS}
            style={{ width: 120 }}
          />
          <Search placeholder="搜索模板" onSearch={handleSearch} style={{ width: 240 }} allowClear />
        </div>
      </div>

      <Spin spinning={loading}>
        {items.length === 0 ? (
          <Empty description="暂无模板" style={{ padding: '60px 0' }} />
        ) : (
          <Row gutter={[16, 16]}>
            {items.map((item) => (
              <Col key={item.id} xs={24} sm={12} lg={8} xl={6}>
                <Card
                  hoverable
                  size="small"
                  title={item.title}
                  extra={
                    <Tag color={CATEGORY_COLORS[item.category || ''] || 'default'}>
                      {item.category || '其他'}
                    </Tag>
                  }
                  actions={[
                    <EyeOutlined key="preview" onClick={() => setPreviewItem(item)} />,
                    <CopyOutlined key="copy" onClick={() => handleCopy(item.amis_json)} />,
                  ]}
                >
                  <div style={{ fontSize: 12, color: '#999', minHeight: 40, marginBottom: 8 }}>
                    {item.description || '暂无描述'}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Tag color={SOURCE_MAP[item.source]?.color || 'default'}>
                      {SOURCE_MAP[item.source]?.label || item.source}
                    </Tag>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Spin>

      {total > 12 && (
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Pagination
            current={page}
            total={total}
            pageSize={12}
            onChange={setPage}
            showTotal={(t) => `共 ${t} 个模板`}
          />
        </div>
      )}

      <Modal
        title={previewItem?.title || '预览'}
        open={!!previewItem}
        onCancel={() => setPreviewItem(null)}
        footer={null}
        width={900}
      >
        {previewItem && (
          <>
            {previewItem.description && (
              <div style={{ marginBottom: 12, color: '#666' }}>{previewItem.description}</div>
            )}
            <Tabs
              activeKey={previewTab}
              onChange={setPreviewTab}
              items={[
                {
                  key: 'preview',
                  label: '页面预览',
                  children: (
                    <div style={{ minHeight: 300, border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'auto' }}>
                      {getSchema(previewItem) ? (
                        <AmisRenderer schema={getSchema(previewItem)} style={{ padding: 16 }} />
                      ) : (
                        <div style={{ color: 'red', padding: 16 }}>JSON 解析失败</div>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'json',
                  label: 'JSON 代码',
                  children: (
                    <pre style={{ maxHeight: 400, overflow: 'auto', background: '#f5f5f5', padding: 16, borderRadius: 8, fontSize: 12 }}>
                      {(() => {
                        try { return JSON.stringify(JSON.parse(previewItem.amis_json), null, 2); } catch { return previewItem.amis_json; }
                      })()}
                    </pre>
                  ),
                },
              ]}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
