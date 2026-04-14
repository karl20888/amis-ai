import { useState, useEffect, useCallback } from 'react';
import { Table, Button, Modal, Form, Input, Switch, Space, message, notification, Popconfirm, Tag } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ApiOutlined } from '@ant-design/icons';
import { getProviders, createProvider, updateProvider, deleteProvider, testProvider } from '../../services/llm';

interface ProviderItem {
  id: number;
  name: string;
  base_url: string;
  api_key_hint: string;
  is_active: boolean;
  created_at: string;
}

export default function LlmProviders() {
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [form] = Form.useForm();

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getProviders();
      setProviders(data);
    } catch {
      message.error('获取供应商列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProviders(); }, [fetchProviders]);

  const handleCreate = () => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true });
    setModalOpen(true);
  };

  const handleEdit = (record: ProviderItem) => {
    setEditingId(record.id);
    form.setFieldsValue({
      name: record.name,
      base_url: record.base_url,
      api_key: '',
      is_active: record.is_active,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingId) {
        const payload: any = { name: values.name, base_url: values.base_url, is_active: values.is_active };
        if (values.api_key) payload.api_key = values.api_key;
        await updateProvider(editingId, payload);
        message.success('更新成功');
      } else {
        await createProvider(values);
        message.success('创建成功');
      }
      setModalOpen(false);
      fetchProviders();
    } catch (err: any) {
      if (err.response?.data?.error) {
        message.error(err.response.data.error);
      }
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteProvider(id);
      message.success('已删除');
      fetchProviders();
    } catch (err: any) {
      message.error(err.response?.data?.error || '删除失败');
    }
  };

  const handleTest = async (id: number) => {
    setTestingId(id);
    try {
      const result = await testProvider(id);
      if (result.status === 'ok') {
        notification.success({ message: '测试通过', description: result.message });
      } else {
        notification.error({ message: '测试失败', description: result.message });
      }
    } catch (err: any) {
      notification.error({
        message: '测试失败',
        description: err.response?.data?.message || '连接测试失败，请检查供应商配置',
      });
    } finally {
      setTestingId(null);
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '名称', dataIndex: 'name' },
    { title: 'API 地址', dataIndex: 'base_url', ellipsis: true },
    { title: 'API Key', dataIndex: 'api_key_hint', width: 120 },
    {
      title: '状态',
      dataIndex: 'is_active',
      width: 80,
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '停用'}</Tag>,
    },
    {
      title: '操作',
      width: 200,
      render: (_: any, record: ProviderItem) => (
        <Space size="small">
          <Button
            size="small"
            icon={<ApiOutlined />}
            loading={testingId === record.id}
            onClick={() => handleTest(record.id)}
          >
            测试
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>LLM 供应商管理</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>新增供应商</Button>
      </div>

      <Table
        dataSource={providers}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={false}
        size="middle"
      />

      <Modal
        title={editingId ? '编辑供应商' : '新增供应商'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：OpenAI、DeepSeek" />
          </Form.Item>
          <Form.Item name="base_url" label="API 地址" rules={[{ required: true, message: '请输入 API 地址' }]}>
            <Input placeholder="如：https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item
            name="api_key"
            label="API Key"
            rules={editingId ? [] : [{ required: true, message: '请输入 API Key' }]}
          >
            <Input.Password placeholder={editingId ? '留空则不修改' : '请输入 API Key'} />
          </Form.Item>
          <Form.Item name="is_active" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
