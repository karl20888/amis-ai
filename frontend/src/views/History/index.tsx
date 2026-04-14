import { useState, useEffect, useCallback } from 'react';
import { Table, Button, Tag, Space, message, Popconfirm, Modal, Tabs } from 'antd';
import { EyeOutlined, CheckOutlined, DeleteOutlined, CopyOutlined } from '@ant-design/icons';
import { getHistoryList, adoptHistory, deleteHistory } from '../../services/generation';
import AmisRenderer from '../../components/AmisRenderer';
import type { GenerationHistory } from '../../types';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  generated: { label: '已生成', color: 'blue' },
  adopted: { label: '已采纳', color: 'green' },
  rejected: { label: '已丢弃', color: 'default' },
};

export default function History() {
  const [items, setItems] = useState<GenerationHistory[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [previewRecord, setPreviewRecord] = useState<GenerationHistory | null>(null);
  const [previewTab, setPreviewTab] = useState('preview');

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getHistoryList(page, 10);
      setItems(data.items);
      setTotal(data.total);
    } catch {
      message.error('获取历史记录失败');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleAdopt = async (record: GenerationHistory) => {
    try {
      await adoptHistory(record.id, {
        final_json: record.generated_json,
      });
      message.success('采纳成功，已加入知识库');
      fetchList();
    } catch (err: any) {
      message.error(err.response?.data?.error || '采纳失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteHistory(id);
      message.success('已删除');
      fetchList();
    } catch (err: any) {
      message.error(err.response?.data?.error || '删除失败');
    }
  };

  const handleCopy = (json: string) => {
    try {
      const formatted = JSON.stringify(JSON.parse(json), null, 2);
      navigator.clipboard.writeText(formatted);
    } catch {
      navigator.clipboard.writeText(json);
    }
    message.success('已复制');
  };

  const getPreviewSchema = (record: GenerationHistory) => {
    const json = record.final_json || record.generated_json;
    try {
      return typeof json === 'string' ? JSON.parse(json) : json;
    } catch {
      return null;
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    {
      title: '需求描述',
      dataIndex: 'user_prompt',
      ellipsis: true,
      width: 300,
    },
    {
      title: '模型',
      dataIndex: 'model_used',
      width: 140,
      render: (v: string | null) => v || '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) => {
        const info = STATUS_MAP[v] || { label: v, color: 'default' };
        return <Tag color={info.color}>{info.label}</Tag>;
      },
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      width: 170,
      render: (v: string) => v?.replace('T', ' ').slice(0, 19) || '-',
    },
    {
      title: '操作',
      width: 200,
      render: (_: any, record: GenerationHistory) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => setPreviewRecord(record)}>
            预览
          </Button>
          <Button size="small" icon={<CopyOutlined />} onClick={() => handleCopy(record.generated_json)} />
          {record.status === 'generated' && (
            <Popconfirm title="确定采纳？将加入知识库" onConfirm={() => handleAdopt(record)}>
              <Button size="small" type="primary" ghost icon={<CheckOutlined />}>采纳</Button>
            </Popconfirm>
          )}
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <h3 style={{ marginBottom: 16 }}>生成历史</h3>

      <Table
        dataSource={items}
        columns={columns}
        rowKey="id"
        loading={loading}
        size="middle"
        pagination={{
          current: page,
          total,
          pageSize: 10,
          onChange: setPage,
          showTotal: (t) => `共 ${t} 条`,
        }}
      />

      <Modal
        title="预览生成结果"
        open={!!previewRecord}
        onCancel={() => setPreviewRecord(null)}
        footer={null}
        width={900}
      >
        {previewRecord && (
          <>
            <div style={{ marginBottom: 12, color: '#666' }}>
              <strong>需求：</strong>{previewRecord.user_prompt}
            </div>
            <Tabs
              activeKey={previewTab}
              onChange={setPreviewTab}
              items={[
                {
                  key: 'preview',
                  label: '页面预览',
                  children: (
                    <div style={{ minHeight: 300, border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'auto' }}>
                      {getPreviewSchema(previewRecord) ? (
                        <AmisRenderer schema={getPreviewSchema(previewRecord)} style={{ padding: 16 }} />
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
                        const json = previewRecord.final_json || previewRecord.generated_json;
                        try { return JSON.stringify(JSON.parse(json), null, 2); } catch { return json; }
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
