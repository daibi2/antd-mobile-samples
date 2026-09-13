import React from 'react';
import { Toast, ActivityIndicator } from 'antd-mobile';
import { api } from './api';
import AuthPage from './AuthPage';
import LedgerPage from './LedgerPage';
import './index.css';

export default class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      ready: false,
      user: null,
    };
  }

  componentDidMount() {
    api('/api/me')
      .then((data) => this.setState({ ready: true, user: data.user }))
      .catch(() => this.setState({ ready: true, user: null }));
  }

  onAuthed = (user) => {
    Toast.success('登录成功', 1);
    this.setState({ user });
  }

  onLogout = () => {
    this.setState({ user: null });
  }

  render() {
    if (!this.state.ready) {
      return (
        <div className="boot">
          <ActivityIndicator size="large" text="加载中" />
        </div>
      );
    }
    if (!this.state.user) {
      return <AuthPage onAuthed={this.onAuthed} />;
    }
    return <LedgerPage user={this.state.user} onLogout={this.onLogout} />;
  }
}
