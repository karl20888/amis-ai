import { Tabs } from 'antd';
import LlmProviders from './LlmProviders';
import ModelConfigs from './ModelConfigs';

export default function Settings() {
  return (
    <Tabs
      defaultActiveKey="providers"
      items={[
        { key: 'providers', label: '供应商管理', children: <LlmProviders /> },
        { key: 'configs', label: '模型配置', children: <ModelConfigs /> },
      ]}
    />
  );
}
