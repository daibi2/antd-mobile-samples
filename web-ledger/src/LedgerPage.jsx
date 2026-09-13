import React from 'react';
import {
  NavBar, List, InputItem, Button, WhiteSpace, WingBlank, Toast, Modal,
  DatePicker, TextareaItem, SegmentedControl,
} from 'antd-mobile';
import { api, formatYuan } from './api';

function today() {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function parseDate(iso) {
  const parts = String(iso).split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function toIsoDate(d) {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function emptyForm() {
  return {
    type: 'expense',
    amount: '',
    category: '餐饮',
    note: '',
    occurred_on: today(),
  };
}

function fromRecord(record) {
  return {
    type: record.type,
    amount: (record.amount_cents / 100).toFixed(2),
    category: record.category,
    note: record.note || '',
    occurred_on: record.occurred_on,
  };
}

export default class LedgerPage extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      loading: true,
      records: [],
      summary: { income_cents: 0, expense_cents: 0, balance_cents: 0 },
      formOpen: false,
      editing: null,
      form: emptyForm(),
      saving: false,
      incomeCategories: ['工资', '奖金', '理财', '其他'],
      expenseCategories: ['餐饮', '交通', '购物', '住房', '娱乐', '其他'],
    };
  }

  componentDidMount() {
    this.reload();
  }

  reload = () => {
    this.setState({ loading: true });
    Promise.all([
      api('/api/records'),
      api('/api/summary'),
      api('/api/meta'),
    ]).then(([recordsRes, summary, meta]) => {
      this.setState({
        loading: false,
        records: recordsRes.records,
        summary,
        incomeCategories: meta.incomeCategories,
        expenseCategories: meta.expenseCategories,
      });
    }).catch((err) => {
      this.setState({ loading: false });
      if (err.status === 401) {
        this.props.onLogout();
        return;
      }
      Toast.fail(err.message, 2);
    });
  }

  logout = () => {
    api('/api/logout', { method: 'POST' }).catch(() => {}).then(() => {
      this.props.onLogout();
    });
  }

  openCreate = () => {
    this.setState({ formOpen: true, editing: null, form: emptyForm() });
  }

  openEdit = (record) => {
    this.setState({ formOpen: true, editing: record, form: fromRecord(record) });
  }

  closeForm = () => {
    this.setState({ formOpen: false, editing: null });
  }

  categories() {
    return this.state.form.type === 'income'
      ? this.state.incomeCategories
      : this.state.expenseCategories;
  }

  setType = (type) => {
    const cats = type === 'income' ? this.state.incomeCategories : this.state.expenseCategories;
    const form = Object.assign({}, this.state.form, { type });
    if (cats.indexOf(form.category) === -1) {
      form.category = cats[0];
    }
    this.setState({ form });
  }

  save = () => {
    if (this.state.saving) return;
    const { form, editing } = this.state;
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      Toast.fail('请填写大于 0 的金额', 1.5);
      return;
    }
    this.setState({ saving: true });
    const body = {
      type: form.type,
      amount,
      category: form.category,
      note: form.note,
      occurred_on: form.occurred_on,
    };
    const req = editing
      ? api(`/api/records/${editing.id}`, { method: 'PUT', body })
      : api('/api/records', { method: 'POST', body });
    req.then(() => {
      this.setState({ saving: false, formOpen: false, editing: null });
      Toast.success(editing ? '已更新' : '已记账', 1);
      this.reload();
    }).catch((err) => {
      this.setState({ saving: false });
      Toast.fail(err.message, 2);
    });
  }

  confirmDelete = (record) => {
    Modal.alert('删除记录', `确定删除「${record.category}」吗？`, [
      { text: '取消' },
      {
        text: '删除',
        style: { color: '#F4333C' },
        onPress: () => {
          api(`/api/records/${record.id}`, { method: 'DELETE' })
            .then(() => {
              Toast.success('已删除', 1);
              this.reload();
            })
            .catch((err) => Toast.fail(err.message, 2));
        },
      },
    ]);
  }

  renderForm() {
    const { form, editing, saving } = this.state;
    return (
      <div className="page">
        <NavBar mode="light" onLeftClick={this.closeForm}>{editing ? '编辑' : '记一笔'}</NavBar>
        <List>
          <List.Item
            extra={
              <SegmentedControl
                values={['支出', '收入']}
                selectedIndex={form.type === 'expense' ? 0 : 1}
                onChange={(e) => this.setType(e.nativeEvent.selectedSegmentIndex === 0 ? 'expense' : 'income')}
                style={{ width: 160 }}
              />
            }
          >
            类型
          </List.Item>
          <InputItem
            type="number"
            value={form.amount}
            onChange={(v) => this.setState({ form: Object.assign({}, form, { amount: v }) })}
            placeholder="0.00"
            extra="元"
          >
            金额
          </InputItem>
          <List.Item wrap>
            分类
            <div className="chips">
              {this.categories().map((c) => (
                <span
                  key={c}
                  className={form.category === c ? 'chip on' : 'chip'}
                  onClick={() => this.setState({ form: Object.assign({}, form, { category: c }) })}
                >
                  {c}
                </span>
              ))}
            </div>
          </List.Item>
          <DatePicker
            mode="date"
            value={parseDate(form.occurred_on)}
            onChange={(d) => this.setState({ form: Object.assign({}, form, { occurred_on: toIsoDate(d) }) })}
          >
            <List.Item arrow="horizontal">日期</List.Item>
          </DatePicker>
          <TextareaItem
            title="备注"
            rows={2}
            count={200}
            value={form.note}
            onChange={(v) => this.setState({ form: Object.assign({}, form, { note: v }) })}
            placeholder="可选"
          />
        </List>
        <WhiteSpace size="lg" />
        <WingBlank>
          <Button type="primary" loading={saving} onClick={this.save}>保存</Button>
          <WhiteSpace />
          <Button onClick={this.closeForm}>取消</Button>
        </WingBlank>
      </div>
    );
  }

  render() {
    if (this.state.formOpen) {
      return this.renderForm();
    }
    const { summary, records, loading } = this.state;
    const { user } = this.props;
    return (
      <div className="page">
        <NavBar
          mode="light"
          rightContent={<span onClick={this.logout}>退出</span>}
        >
          记账
        </NavBar>
        <div className="summary">
          <div>
            <div className="label">收入</div>
            <div className="value income">{formatYuan(summary.income_cents)}</div>
          </div>
          <div>
            <div className="label">支出</div>
            <div className="value expense">{formatYuan(summary.expense_cents)}</div>
          </div>
          <div>
            <div className="label">结余</div>
            <div className="value">{formatYuan(summary.balance_cents)}</div>
          </div>
        </div>
        <WingBlank>
          <div className="user-line">当前用户：{user.username}</div>
          <Button type="primary" onClick={this.openCreate}>记一笔</Button>
        </WingBlank>
        <WhiteSpace />
        <List renderHeader={() => (loading ? '加载中…' : `账单（${records.length}）`)}>
          {records.length === 0 && !loading ? (
            <List.Item>暂无记录，点上方「记一笔」开始记账</List.Item>
          ) : null}
          {records.map((item) => {
            const sign = item.type === 'income' ? '+' : '-';
            const extraClass = item.type === 'income' ? 'income' : 'expense';
            return (
              <List.Item
                key={item.id}
                extra={<span className={extraClass}>{sign}{formatYuan(item.amount_cents)}</span>}
                multipleLine
              >
                {item.category}
                <List.Item.Brief>
                  {item.occurred_on}{item.note ? ` · ${item.note}` : ''}
                  <span className="row-actions">
                    <a onClick={() => this.openEdit(item)}>编辑</a>
                    <a className="danger" onClick={() => this.confirmDelete(item)}>删除</a>
                  </span>
                </List.Item.Brief>
              </List.Item>
            );
          })}
        </List>
      </div>
    );
  }
}
