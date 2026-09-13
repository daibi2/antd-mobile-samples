import React from 'react';
import { NavBar, List, InputItem, Button, WhiteSpace, WingBlank, Toast, SegmentedControl } from 'antd-mobile';
import { api } from './api';

export default class AuthPage extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      mode: 'login',
      username: '',
      password: '',
      loading: false,
    };
  }

  onSubmit = () => {
    const { mode, username, password, loading } = this.state;
    if (loading) return;
    if (!username.trim() || !password) {
      Toast.fail('请填写用户名和密码', 1.5);
      return;
    }
    this.setState({ loading: true });
    const path = mode === 'login' ? '/api/login' : '/api/register';
    api(path, { method: 'POST', body: { username: username.trim(), password } })
      .then((data) => {
        this.setState({ loading: false });
        this.props.onAuthed(data.user);
      })
      .catch((err) => {
        this.setState({ loading: false });
        Toast.fail(err.message, 2);
      });
  }

  render() {
    const { mode, username, password, loading } = this.state;
    return (
      <div className="page">
        <NavBar mode="light">记账工具</NavBar>
        <WhiteSpace size="lg" />
        <WingBlank>
          <SegmentedControl
            values={['登录', '注册']}
            selectedIndex={mode === 'login' ? 0 : 1}
            onChange={(e) => this.setState({ mode: e.nativeEvent.selectedSegmentIndex === 0 ? 'login' : 'register' })}
          />
        </WingBlank>
        <WhiteSpace />
        <List>
          <InputItem
            value={username}
            onChange={(v) => this.setState({ username: v })}
            placeholder="3-32 位字母数字或下划线"
            clear
          >
            用户名
          </InputItem>
          <InputItem
            type="password"
            value={password}
            onChange={(v) => this.setState({ password: v })}
            placeholder={mode === 'register' ? '至少 8 位' : '请输入密码'}
          >
            密码
          </InputItem>
        </List>
        <WhiteSpace size="lg" />
        <WingBlank>
          <Button type="primary" loading={loading} onClick={this.onSubmit}>
            {mode === 'login' ? '登录' : '注册并登录'}
          </Button>
        </WingBlank>
      </div>
    );
  }
}
