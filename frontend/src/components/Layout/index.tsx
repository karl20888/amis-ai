import { Navigate, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Avatar, Dropdown, theme } from 'antd';
import {
  MessageOutlined,
  HistoryOutlined,
  AppstoreOutlined,
  SettingOutlined,
  LogoutOutlined,
  UserOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../stores';

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: '/chat', icon: <MessageOutlined />, label: '智能生成' },
  { key: '/history', icon: <HistoryOutlined />, label: '生成历史' },
  { key: '/templates', icon: <AppstoreOutlined />, label: '模板库' },
  { key: '/settings', icon: <SettingOutlined />, label: '系统设置' },
];

export default function AppLayout() {
  const { token: authToken, user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();

  if (!authToken) {
    return <Navigate to="/login" replace />;
  }

  const dropdownItems = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: () => {
        logout();
        navigate('/login');
      },
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={220}
        style={{ background: token.colorBgContainer }}
      >
        <div style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}>
          <RobotOutlined style={{ fontSize: 24, color: token.colorPrimary, marginRight: 8 }} />
          <span style={{ fontSize: 18, fontWeight: 600, color: token.colorText }}>
            amis-ai
          </span>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderRight: 0, marginTop: 8 }}
        />
      </Sider>
      <Layout>
        <Header style={{
          background: token.colorBgContainer,
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}>
          <Dropdown menu={{ items: dropdownItems }} placement="bottomRight">
            <Button type="text" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar size="small" icon={<UserOutlined />} />
              <span>{user?.username || '用户'}</span>
            </Button>
          </Dropdown>
        </Header>
        <Content style={{ margin: 16, padding: 24, background: token.colorBgContainer, borderRadius: token.borderRadiusLG }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
